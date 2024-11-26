import fs from "node:fs"
import { Connection, Keypair } from "@solana/web3.js"
import "dotenv/config"

export const connection = new Connection(process.env.RPC_URL!, "confirmed")
export const owner = Keypair.fromSecretKey(
	Uint8Array.from(
		JSON.parse(fs.readFileSync(process.env.MAIN_WALLET_PATH!, "utf-8"))
	)
)
