import fs from "node:fs"
import { z } from "zod"
import { notEmptyStr, positiveNumber, pubkey } from "./parser.js"

export type Config = z.infer<typeof schema>

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
	max_sol: positiveNumber()
})

export function parseConfig() {
	const config = schema.parse(
		JSON.parse(fs.readFileSync("config.json", "utf-8"))
	)

	return config
}
