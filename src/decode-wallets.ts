import fs from "node:fs"
import { decryptedFilePath, encryptedFilePath } from "./config.js"
import { decryptWallet } from "./hashing.js"

function main() {
	const wallets = fs
		.readFileSync(encryptedFilePath, "utf8")
		.split("\n")
		.filter(Boolean)
		.map(decryptWallet)

	fs.writeFileSync(decryptedFilePath, JSON.stringify(wallets, null, 1), "utf-8")
}

main()
