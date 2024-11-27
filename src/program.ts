import fs from "node:fs/promises"
import * as spl from "@solana/spl-token"
import * as web3 from "@solana/web3.js"
import { DateTime } from "luxon"
import type { Config } from "./config.js"
import { getPrice } from "./services.js"
import { apiSwap } from "./trading.js"
import {
	bigintPercent,
	formatSol,
	formatToken,
	parseSol,
	parseToken,
	percent,
	tryToInsufficient
} from "./utils.js"

type SubAccount = {
	account: web3.Keypair
	tradingTimes: number
}

export class Program {
	constructor(
		private connection: web3.Connection,
		private owner: web3.Keypair,
		private config: Config
	) {}

	async run() {
		let subAccounts = await this.generateAccounts(
			this.config.walletsConcurrency
		)

		await this.initTokensAndNative(subAccounts)

		for (;;) {
			if (subAccounts.length === 0) {
				console.log("🦀 🦀 🦀 All sub_accounts are insufficient >> finished")
				return
			}

			const executingAccounts = subAccounts.map(({ account }) => ({
				address: account.publicKey,
				privateKey: account.secretKey
			}))

			await fs.writeFile(
				"executing-wallets.txt",
				`${JSON.stringify(executingAccounts, null, 1)}`
			)

			const rs = await Promise.allSettled(
				subAccounts.map(async subAccount =>
					tryToInsufficient(() => this.trade(subAccount))
				)
			)

			subAccounts = []

			for (const result of rs) {
				if (result.status === "fulfilled") subAccounts.push(result.value)
			}

			if (subAccounts.length > 0) {
				console.log(
					`switch to new accounts ${subAccounts.map(account => account.account.publicKey.toBase58())}`
				)
			}
		}
	}

	private generateAccounts(quantity: number): Promise<SubAccount[]> {
		return Promise.all(
			new Array(quantity).fill(1).map(async () => {
				const account = web3.Keypair.generate()

				const walletData = {
					pubkey: account.publicKey.toBase58(),
					secret: Array.from(account.secretKey),
					date: DateTime.now().toISO()
				}

				await fs.appendFile("wallets.txt", `${JSON.stringify(walletData)}\n`)

				return {
					account,
					tradingTimes: 0
				}
			})
		)
	}

	private async initTokensAndNative(subAccounts: SubAccount[]) {
		for (const subAccount of subAccounts) {
			await this.transferAssets(
				this.owner,
				subAccount.account,
				this.config.initSolPerWallet,
				this.config.initTokensPerWallet
			)
		}
	}

	private async transferAssets(
		sender: web3.Keypair,
		receiver: web3.Keypair,
		lamports: bigint,
		tokenAmount: bigint
	) {
		const transaction = new web3.Transaction()

		transaction.add(
			web3.SystemProgram.transfer({
				fromPubkey: sender.publicKey,
				toPubkey: receiver.publicKey,
				lamports
			})
		)

		const senderAtaAddress = await spl.getAssociatedTokenAddress(
			this.config.mint,
			sender.publicKey
		)

		const receiverAtaAddress = await spl.getAssociatedTokenAddress(
			this.config.mint,
			receiver.publicKey
		)

		try {
			await spl.getAccount(this.connection, receiverAtaAddress)
		} catch (error) {
			if (
				error instanceof spl.TokenAccountNotFoundError ||
				error instanceof spl.TokenInvalidAccountOwnerError
			) {
				transaction.add(
					spl.createAssociatedTokenAccountInstruction(
						sender.publicKey,
						receiverAtaAddress,
						receiver.publicKey,
						this.config.mint
					)
				)
			} else {
				throw error
			}
		}

		transaction.add(
			spl.createTransferInstruction(
				senderAtaAddress,
				receiverAtaAddress,
				sender.publicKey,
				tokenAmount
			)
		)

		await web3.sendAndConfirmTransaction(this.connection, transaction, [sender])

		console.log(
			`${sender.publicKey} transfered `,
			formatSol(lamports),
			` sols to ${receiver.publicKey}`
		)

		console.log(
			`${sender.publicKey} transfered `,
			formatToken(tokenAmount),
			` tokens to ${receiver.publicKey}`
		)
	}

	private async getBalanceAndTokenBalance(pubkey: web3.PublicKey) {
		const balance = await this.connection.getBalance(pubkey, "finalized")

		const ataAddress = await spl.getAssociatedTokenAddress(
			this.config.mint,
			pubkey
		)
		const ataAccount = await spl.getAccount(this.connection, ataAddress)

		return [BigInt(balance), ataAccount.amount]
	}

	private async calculateBeforeSwap(subAccount: SubAccount) {
		const [balance, tokenBalance] = await this.getBalanceAndTokenBalance(
			subAccount.account.publicKey
		)

		const price = await getPrice([spl.NATIVE_MINT, this.config.mint])

		const nativePriceInUSD = Number(price[spl.NATIVE_MINT.toBase58()])
		const tokenPriceInUSD = Number(price[this.config.mint.toBase58()])

		const balanceInUsd = Number(formatSol(balance)) * nativePriceInUSD

		const tokenBalanceInUsd =
			Number(formatToken(tokenBalance)) * tokenPriceInUSD

		console.log(
			`${subAccount.account.publicKey.toBase58()} before swap `,
			subAccount.tradingTimes,
			{
				balanceInUsd,
				tokenBalanceInUsd
			}
		)

		const target = (balanceInUsd + tokenBalanceInUsd) / 2

		if (balanceInUsd > tokenBalanceInUsd) {
			const amount = balanceInUsd - target + percent(balanceInUsd, 10)

			return {
				amount: parseSol(amount / nativePriceInUSD),
				inMint: spl.NATIVE_MINT,
				outMint: this.config.mint
			}
		}

		const amount = tokenBalanceInUsd - target + percent(tokenBalanceInUsd, 10)

		return {
			amount: parseToken(amount / tokenPriceInUSD),
			inMint: this.config.mint,
			outMint: spl.NATIVE_MINT
		}
	}

	private async createNewSubAccountAndTransferAssets(subAccount: SubAccount) {
		const [newSubAccount] = await this.generateAccounts(1)

		const [balance, tokenBalance] = await this.getBalanceAndTokenBalance(
			subAccount.account.publicKey
		)

		await this.transferAssets(
			subAccount.account,
			newSubAccount.account,
			bigintPercent(balance, this.config.amountTransferPercent),
			bigintPercent(tokenBalance, this.config.amountTransferPercent)
		)

		return newSubAccount
	}

	private async trade(subAccount: SubAccount): Promise<SubAccount> {
		if (subAccount.tradingTimes === this.config.numberOfTradesPerWallet) {
			const newsubAccount =
				await this.createNewSubAccountAndTransferAssets(subAccount)

			return newsubAccount
		}

		const { amount, inMint, outMint } =
			await this.calculateBeforeSwap(subAccount)

		await apiSwap(this.connection, {
			owner: subAccount.account,
			inputMint: inMint.toBase58(),
			outputMint: outMint.toBase58(),
			amountIn: amount,
			slippage: this.config.slippage
		})

		subAccount.tradingTimes++

		return this.trade(subAccount)
	}
}
