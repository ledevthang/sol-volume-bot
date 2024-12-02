import { getMint } from "@solana/spl-token"
import { parseConfig } from "./config.js"
import { Program } from "./program.js"

async function main() {
	const { connection, owner, config } = parseConfig()

	const mintAccount = await getMint(connection, config.mint)

	const program = new Program(connection, owner, config, mintAccount.decimals)

	await program.run()
}

main()
