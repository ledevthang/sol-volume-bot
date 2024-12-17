import fs from "node:fs/promises"
import * as spl from "@solana/spl-token"
import * as web3 from "@solana/web3.js"
import bs58 from "bs58"
import { DateTime } from "luxon"
import type { Config } from "./config.js"
import { decryptWallet, encryptWallet } from "./hashing.js"
import { Logger } from "./logger.js"
import { apiSwap } from "./trading.js"
import {
	bigintPercent,
	formatSol,
	formatToken,
	parseSol,
	parseToken,
	random,
	sleep,
	tryToInsufficient
} from "./utils.js"

export class Program {
	constructor(
		private connection: web3.Connection,
		private root: web3.Keypair,
		private mint: spl.Mint,
		private config: Config
	) {}

	public async run() {
		let account = this.root

		for (;;) {
			account = await tryToInsufficient(() => this.executeTrades(account))
		}
	}

	private async executeTrades(account: web3.Keypair): Promise<web3.Keypair> {
		let buyCount = 0
		let sellCount = 0
		let isBuy = true

		for (;;) {
			if (buyCount === this.config.consecutive_buys) isBuy = false

			if (
				buyCount >= this.config.consecutive_buys &&
				sellCount >= this.config.consecutive_sells
			)
				return this.createNewAccountAndTransfer(account)

			const [solBalance, tokenBalance] = await this.balance(account.publicKey)

			Logger.info("balance::", {
				solBalance: formatSol(solBalance),
				tokenBalance: formatToken(tokenBalance, this.mint.decimals)
			})

			const randUiAmount = random(this.config.min_sol, this.config.max_sol)

			const amount = isBuy
				? parseSol(randUiAmount)
				: parseToken(randUiAmount, this.mint.decimals)

			if (isBuy && solBalance < amount) {
				Logger.error(
					`Insufficient SOL for buy. Required: ${formatSol(amount)}, Available: ${formatSol(solBalance)}`
				)
				await sleep(2_000)
				continue
			}

			if (!isBuy && tokenBalance < amount) {
				Logger.error(
					`Insufficient tokens for sell. Required: ${formatToken(amount, this.mint.decimals)}, Available: ${formatToken(tokenBalance, this.mint.decimals)}`
				)
				await sleep(2_000)
				continue
			}

			const outputAmount = await apiSwap(this.connection, {
				owner: this.root,
				inputMint: isBuy
					? spl.NATIVE_MINT.toBase58()
					: this.mint.address.toBase58(),
				outputMint: isBuy
					? this.mint.address.toBase58()
					: spl.NATIVE_MINT.toBase58(),
				amountIn: amount,
				slippage: this.config.slippage
			})

			const message = isBuy
				? `Buy ${formatToken(BigInt(outputAmount), this.mint.decimals)} tokens @ ${formatSol(BigInt(amount))} SOL`
				: `Sell ${formatToken(amount, this.mint.decimals)} tokens @ ${formatSol(BigInt(outputAmount))} SOL`

			Logger.info(message)

			if (isBuy) buyCount++
			else sellCount++

			const restTime =
				random(this.config.wait_time_min, this.config.wait_time_max) * 1000

			await sleep(restTime)
		}
	}

	private async transferSolAndToken(
		sender: web3.Keypair,
		receiver: web3.Keypair,
		lamports: bigint,
		tokenAmount: bigint
	) {
		const instructions = []

		const senderAtaAddress = await spl.getAssociatedTokenAddress(
			this.mint.address,
			sender.publicKey
		)

		const receiverAtaAddress = await spl.getAssociatedTokenAddress(
			this.mint.address,
			receiver.publicKey
		)

		try {
			await spl.getAccount(this.connection, receiverAtaAddress)
		} catch (error) {
			if (
				error instanceof spl.TokenAccountNotFoundError ||
				error instanceof spl.TokenInvalidAccountOwnerError
			) {
				instructions.push(
					spl.createAssociatedTokenAccountInstruction(
						sender.publicKey,
						receiverAtaAddress,
						receiver.publicKey,
						this.mint.address
					)
				)
			} else {
				throw error
			}
		}

		instructions.push(
			spl.createTransferInstruction(
				senderAtaAddress,
				receiverAtaAddress,
				sender.publicKey,
				tokenAmount
			)
		)

		instructions.push(
			web3.SystemProgram.transfer({
				fromPubkey: sender.publicKey,
				toPubkey: receiver.publicKey,
				lamports
			})
		)

		const { blockhash, lastValidBlockHeight } =
			await this.connection.getLatestBlockhash()

		const message = new web3.TransactionMessage({
			payerKey: sender.publicKey,
			recentBlockhash: blockhash,
			instructions
		}).compileToV0Message()

		const fee = await this.connection.getFeeForMessage(message)

		if (fee.value) {
			const lamportsNeedToTransfer = lamports - BigInt(fee.value)

			instructions.pop()

			instructions.push(
				web3.SystemProgram.transfer({
					fromPubkey: sender.publicKey,
					toPubkey: receiver.publicKey,
					lamports: lamportsNeedToTransfer
				})
			)
		}

		const transaction = new web3.VersionedTransaction(message)

		transaction.sign([sender])

		const signature = await this.connection.sendTransaction(transaction)

		await this.connection.confirmTransaction(
			{
				blockhash,
				lastValidBlockHeight,
				signature
			},
			"confirmed"
		)
	}

	private async balance(pubkey: web3.PublicKey) {
		const balance = await this.connection.getBalance(pubkey)

		const ataAddress = await spl.getAssociatedTokenAddress(
			this.mint.address,
			pubkey
		)

		const ataAccount = await spl.getAccount(this.connection, ataAddress)

		return [BigInt(balance), ataAccount.amount]
	}

	private async createNewAccountAndTransfer(previousAccount: web3.Keypair) {
		const account = web3.Keypair.generate()

		const encrypted = encryptWallet({
			account,
			createdAt: DateTime.now()
		})

		await fs.appendFile("solana-wallets.txt", `\n${encrypted}`)

		const [balance, tokenBalance] = await this.balance(
			previousAccount.publicKey
		)

		await this.transferSolAndToken(
			previousAccount,
			account,
			bigintPercent(balance, 99),
			bigintPercent(tokenBalance, 99)
		)

		return account
	}

	public async withdraw() {
		const wallets = await fs
			.readFile("evm-wallets.txt", "utf8")
			.then(rawLines => rawLines.split("\n"))
			.then(lines => lines.filter(Boolean))
			.then(rawWallets => rawWallets.map(decryptWallet))

		for (const wallet of wallets) {
			const sender = web3.Keypair.fromSecretKey(bs58.decode(wallet.privateKey))

			try {
				const [lamports, tokenBalance] = await this.balance(sender.publicKey)

				const instructions = []

				const senderAtaAddress = await spl.getAssociatedTokenAddress(
					this.mint.address,
					sender.publicKey
				)

				const receiverAtaAddress = await spl.getAssociatedTokenAddress(
					this.mint.address,
					this.root.publicKey
				)

				if (tokenBalance > 0n)
					instructions.push(
						spl.createTransferInstruction(
							senderAtaAddress,
							receiverAtaAddress,
							sender.publicKey,
							tokenBalance
						)
					)

				if (lamports > 0)
					instructions.push(
						web3.SystemProgram.transfer({
							fromPubkey: sender.publicKey,
							toPubkey: this.root.publicKey,
							lamports
						})
					)

				if (instructions.length === 0) continue

				const { blockhash, lastValidBlockHeight } =
					await this.connection.getLatestBlockhash()

				const message = new web3.TransactionMessage({
					payerKey: this.root.publicKey,
					recentBlockhash: blockhash,
					instructions
				}).compileToV0Message()

				const transaction = new web3.VersionedTransaction(message)

				transaction.sign([sender, this.root])

				const signature = await this.connection.sendTransaction(transaction)

				await this.connection.confirmTransaction(
					{
						blockhash,
						lastValidBlockHeight,
						signature
					},
					"confirmed"
				)

				Logger.info(`withdrawed from ${sender.publicKey.toBase58()}`)
			} catch {}
		}
	}
}
