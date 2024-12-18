import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { notEmptyStr, positiveNumber, pubkey } from "./parser.js"

export type Config = z.infer<typeof schema>

const processDir = process.cwd()

export const encryptedFilePath = path.resolve(processDir, "solana-wallets.txt")

export const decryptedFilePath = path.resolve(
	processDir,
	"solana-decoded-wallets.txt"
)

const schema = z.object({
	private_key: notEmptyStr(),
	rpc_url: z.string().url(),

	token_address: pubkey(),

	slippage: positiveNumber(),

	consecutive_buys: z.number().int().min(0),
	consecutive_sells: z.number().int().min(0),

	wait_time_min: positiveNumber(), // in seconds
	wait_time_max: positiveNumber(), // in seconds

	min_sol: positiveNumber(),
	max_sol: positiveNumber(),
	start_with_buy: z.boolean()
})

export function parseConfig() {
	const configFilePath = path.resolve(import.meta.dirname, "config.json")

	const config = schema.parse(
		JSON.parse(fs.readFileSync(configFilePath, "utf-8"))
	)

	return config
}
