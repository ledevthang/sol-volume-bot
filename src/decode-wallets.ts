import fs from "node:fs"
import { decryptWallet } from "./hashing.js"

function main() {
	const wallets = fs
		.readFileSync("solana-wallets.txt", "utf8")
		.split("\n")
		.filter(Boolean)
		.map(decryptWallet)

	fs.writeFileSync(
		"solana-decoded-wallets.txt",
		JSON.stringify(wallets, null, 1),
		"utf-8"
	)
}

main()
