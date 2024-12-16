import { getMint } from "@solana/spl-token"
import { Connection, Keypair } from "@solana/web3.js"
import bs58 from "bs58"
import { parseConfig } from "./config.js"
import { Program } from "./program.js"

async function main() {
	const config = parseConfig()

	const connection = new Connection(config.rpc_url, "confirmed")
	const root = Keypair.fromSecretKey(bs58.decode(config.private_key))

	const mint = await getMint(connection, config.token_address)

	const program = new Program(connection, root, mint, config)

	await program.run()
}

main()
