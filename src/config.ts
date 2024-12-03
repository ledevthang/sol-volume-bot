import fs from "node:fs"
import {
	Connection,
	Keypair,
	LAMPORTS_PER_SOL,
	PublicKey
} from "@solana/web3.js"
import bs58 from "bs58"
import { z } from "zod"

export type Config = {
	mint: PublicKey
	numberOfTradesPerWallet: number
	initTokensPerWallet: bigint
	initSolPerWallet: bigint
	amountTransferPercent: number
	walletsConcurrency: number
	slippage: number
}

export function parseConfig() {
	const envSchema = z.object({
		RPC_URL: z.string().url(),
		WALLET: z.string()
	})

	const configSchema = z.object({
		mint: z.string().transform(mint => new PublicKey(mint)),
		numberOfTradesPerWallet: z.number().int().positive().min(1),
		initSolPerWallet: z
			.number()
			.positive()
			.transform(val => BigInt(val * LAMPORTS_PER_SOL)),
		initTokensPerWallet: z
			.number()
			.positive()
			.transform(val => BigInt(val * 1_000_000)),
		amountTransferPercent: z.number().positive(),
		walletsConcurrency: z.number().int().positive().min(1),
		slippage: z.number().positive()
	})

	const { RPC_URL, WALLET } = envSchema.parse(process.env)

	const config: Config = configSchema.parse(
		JSON.parse(fs.readFileSync("volume-config.json", "utf-8"))
	)

	const connection = new Connection(RPC_URL, "confirmed")
	const owner = Keypair.fromSecretKey(bs58.decode(WALLET))

	return { connection, owner, config }
}
