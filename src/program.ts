import fs from "node:fs/promises"
import * as spl from "@solana/spl-token"
import * as web3 from "@solana/web3.js"
import bs58 from "bs58"
import { Decimal } from "decimal.js"
import { DateTime } from "luxon"
import { type Config, encryptedFilePath } from "./config.js"
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
	sleep
} from "./utils.js"

export class Program {
	private num_sells: number
	private num_buys: number
	private is_buy: boolean
	private current_account: web3.Keypair

	constructor(
		private connection: web3.Connection,
		private root: web3.Keypair,
		private mint: spl.Mint,
		private config: Config
	) {
		this.num_sells = 0
		this.num_buys = 0
		this.is_buy = config.start_with_buy
		this.current_account = root
	}

	public async run() {
		Logger.info(`Starting sol volume bot for token ${this.mint.address}...`)
		Logger.info(
			`Beginning with wallet: ${this.current_account.publicKey.toBase58()}`
		)
		Logger.newLine()

		for (;;) {
			try {
				await this.unsafeRun()
			} catch (error) {
				logError(error)

				Logger.info("Retrying ...")
				Logger.newLine()

				await sleep(3000)
			}
		}
	}

	private async unsafeRun() {
		for (;;) {
			if (this.num_buys === this.config.consecutive_buys) this.is_buy = false

			if (this.num_sells === this.config.consecutive_sells) this.is_buy = true

			if (
				this.num_buys >= this.config.consecutive_buys &&
				this.num_sells >= this.config.consecutive_sells
			) {
				const account = await this.createNewAccountThenTransfer()

				this.num_sells = 0
				this.num_buys = 0
				this.is_buy = this.config.start_with_buy
				this.current_account = account

				Logger.info(
					`Switching to account ${this.current_account.publicKey.toBase58()}...`
				)
				Logger.newLine()

				await sleep(3000)

				continue
			}

			const [solBalance, tokenBalance] = await this.balance(
				this.current_account.publicKey
			)

			let uiAmount = random(this.config.min_sol, this.config.max_sol)

			if (!this.is_buy) {
				const price = await getPrice([spl.NATIVE_MINT, this.mint.address])

				const solPriceInUsd = new Decimal(price[spl.NATIVE_MINT.toBase58()])

				const tokenPriceInUsd = new Decimal(price[this.mint.address.toBase58()])

				uiAmount = solPriceInUsd.div(tokenPriceInUsd).mul(uiAmount).toNumber()
			}

			const amount = this.is_buy
				? parseSol(uiAmount)
				: parseToken(uiAmount, this.mint.decimals)

			Logger.info(this.current_account.publicKey.toBase58(), "::", {
				solBalance: formatSol(solBalance),
				tokenBalance: formatToken(tokenBalance, this.mint.decimals),
				is_buy: this.is_buy,
				amount: uiAmount
			})

			if (this.is_buy && solBalance < amount) {
				Logger.error(
					`Insufficient SOL for buy. Required: ${formatSol(amount)}, Available: ${formatSol(solBalance)}`
				)
				Logger.newLine()

				await sleep(3_000)
				continue
			}

			if (!this.is_buy && tokenBalance < amount) {
				Logger.error(
					`Insufficient tokens for sell. Required: ${formatToken(amount, this.mint.decimals)}, Available: ${formatToken(tokenBalance, this.mint.decimals)}`
				)
				Logger.newLine()

				await sleep(3_000)
				continue
			}

			const outputAmount = await apiSwap(this.connection, {
				owner: this.current_account,
				inputMint: this.is_buy
					? spl.NATIVE_MINT.toBase58()
					: this.mint.address.toBase58(),
				outputMint: this.is_buy
					? this.mint.address.toBase58()
					: spl.NATIVE_MINT.toBase58(),
				amountIn: amount,
				slippage: this.config.slippage
			})

			const message = this.is_buy
				? `Buy ${formatToken(BigInt(outputAmount), this.mint.decimals)} tokens @ ${formatSol(BigInt(amount))} SOL`
				: `Sell ${formatToken(amount, this.mint.decimals)} tokens @ ${formatSol(BigInt(outputAmount))} SOL`

			Logger.info(message)

			if (this.is_buy) this.num_buys++
			else this.num_sells++

			const restTime =
				random(this.config.wait_time_min, this.config.wait_time_max) * 1000

			Logger.info("Sleeping...before next order")
			Logger.newLine()

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

	private async createNewAccountThenTransfer(): Promise<web3.Keypair> {
		const account = web3.Keypair.generate()

		const encrypted = encryptWallet({
			account,
			createdAt: DateTime.now()
		})

		await fs.appendFile(encryptedFilePath, `\n${encrypted}`)

		Logger.newLine()
		Logger.info(`Created a new account ${account.publicKey.toBase58()}`)

		const [balance, tokenBalance] = await this.balance(
			this.current_account.publicKey
		)

		let lamportsToSend = bigintPercent(balance, 99)

		for (;;) {
			try {
				await this.transferSolAndToken(
					this.current_account,
					account,
					lamportsToSend,
					bigintPercent(tokenBalance, 99)
				)

				Logger.info("Transfered 99% assets to new account")

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
			.readFile(encryptedFilePath, "utf8")
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

				Logger.info(`Withdrawed from ${sender.publicKey.toBase58()}`)
			} catch (error) {
				logError(error)
			}
		}
	}
}
