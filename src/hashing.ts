import crypto from "node:crypto"
import type { Keypair } from "@solana/web3.js"
import bs58 from "bs58"
import type { DateTime } from "luxon"

type Wallet = {
	account: Keypair
	createdAt: DateTime
}

type DecryptedWallet = {
	address: string
	privateKey: string
	createdAt: string
}

const key = crypto
	.createHash("sha256")
	.update(process.env.HASH_SECRET!)
	.digest("hex")
	.slice(0, 32)

const iv = crypto
	.createHash("md5")
	.update(process.env.HASH_SECRET!)
	.digest("hex")
	.slice(0, 16)

export function encryptWallet(wallet: Wallet) {
	const cipher = crypto.createCipheriv("aes-256-cbc", key, iv)

	const data = JSON.stringify({
		address: wallet.account.publicKey.toBase58(),
		privateKey: bs58.encode(wallet.account.secretKey),
		createdAt: wallet.createdAt.toISO()
	})

	let encrypted = cipher.update(data, "utf8", "hex")

	encrypted += cipher.final("hex")

	return encrypted
}

export function decryptWallet(encryptedData: string): DecryptedWallet {
	const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv)

	let decrypted = decipher.update(encryptedData, "hex", "utf8")

	decrypted += decipher.final("utf8")

	return JSON.parse(decrypted)
}
