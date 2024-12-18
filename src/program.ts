import fs from "node:fs/promises"
import * as spl from "@solana/spl-token"
import * as web3 from "@solana/web3.js"
import bs58 from "bs58"
import { Decimal } from "decimal.js"
import { DateTime } from "luxon"
import type { Config } from "./config.js"
import { decryptWallet, encryptWallet } from "./hashing.js"
import { Logger } from "./logger.js"
import { getPrice } from "./services.js"
import { apiSwap } from "./trading.js"
import {
	bigintPercent,
	formatSol,
	formatToken,
	logError,
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
		Logger.info(`Starting sol volume bot for token ${this.mint.address}...`)
		Logger.info(`Beginning with wallet: ${this.root.publicKey}`)

		let account = this.root

		for (;;) {
			try {
				account = await this.executeTrades(account)
			} catch (error) {
				logError(error)
				return
			}
		}
	}

	private async executeTrades(account: web3.Keypair): Promise<web3.Keypair> {
		let buyCount = 0
		let sellCount = 0
		let isBuy = this.config.start_with_buy

		for (;;) {
			if (buyCount === this.config.consecutive_buys) isBuy = false

			if (sellCount === this.config.consecutive_sells) isBuy = true

			if (
				buyCount >= this.config.consecutive_buys &&
				sellCount >= this.config.consecutive_sells
			) {
				const newAccount = await tryToInsufficient("transfer assets", () =>
					this.createNewAccountAndTransfer(account)
				)
				return newAccount
			}

			const out = await tryToInsufficient("swap", async () => {
				const [solBalance, tokenBalance] = await this.balance(account.publicKey)

				let uiAmount = random(this.config.min_sol, this.config.max_sol)

				if (!isBuy) {
					const price = await getPrice([spl.NATIVE_MINT, this.mint.address])

					const solPriceInUsd = new Decimal(price[spl.NATIVE_MINT.toBase58()])

					const tokenPriceInUsd = new Decimal(
						price[this.mint.address.toBase58()]
					)

					uiAmount = solPriceInUsd.div(tokenPriceInUsd).mul(uiAmount).toNumber()
				}

				const amount = isBuy
					? parseSol(uiAmount)
					: parseToken(uiAmount, this.mint.decimals)

				Logger.info(account.publicKey.toBase58(), "::", {
					solBalance: formatSol(solBalance),
					tokenBalance: formatToken(tokenBalance, this.mint.decimals),
					isBuy,
					amount: uiAmount
				})

				if (isBuy && solBalance < amount) {
					Logger.error(
						`Insufficient SOL for buy. Required: ${formatSol(amount)}, Available: ${formatSol(solBalance)}`
					)
					await sleep(3_000)
					return
				}

				if (!isBuy && tokenBalance < amount) {
					Logger.error(
						`Insufficient tokens for sell. Required: ${formatToken(amount, this.mint.decimals)}, Available: ${formatToken(tokenBalance, this.mint.decimals)}`
					)
					await sleep(3_000)
					return
				}

				const outputAmount = await apiSwap(this.connection, {
					owner: account,
					inputMint: isBuy
						? spl.NATIVE_MINT.toBase58()
						: this.mint.address.toBase58(),
					outputMint: isBuy
						? this.mint.address.toBase58()
						: spl.NATIVE_MINT.toBase58(),
					amountIn: amount,
					slippage: this.config.slippage
				})

				return { amount, outputAmount }
			})

			if (!out) continue

			const { amount, outputAmount } = out

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

		Logger.newLine()
		Logger.info(`created a new account ${account.publicKey.toBase58()}`)

		const [balance, tokenBalance] = await this.balance(
			previousAccount.publicKey
		)

		let lamportsToSend = bigintPercent(balance, 99)

		for (;;) {
			Logger.info("lamportsToSend: ", lamportsToSend)

			try {
				await this.transferSolAndToken(
					previousAccount,
					account,
					lamportsToSend,
					bigintPercent(tokenBalance, 99)
				)

				Logger.info("transfered 99% assets to new account")
				Logger.newLine()

				return account
			} catch (error: any) {
				const regex = /Transfer: insufficient lamports (\d+), need (\d+)/
				const match = (error?.message as string)?.match(regex)

				if (match) {
					const lamportsAvaiable = BigInt(match[1])
					const lamportsNeeded = BigInt(match[2])

					lamportsToSend -= lamportsNeeded - lamportsAvaiable

					continue
				}

				throw error
			}
		}
	}

	public async withdraw() {
		const wallets = await fs
			.readFile("solana-wallets.txt", "utf8")
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
			} catch (error) {
				logError(error)
			}
		}
	}
}
