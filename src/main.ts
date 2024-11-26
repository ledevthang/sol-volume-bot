import { parseConfig } from "./config.js"
import { Program } from "./program.js"

async function main() {
	const { connection, owner, config } = parseConfig()

	const program = new Program(connection, owner, config)

	await program.run()
}

main()
