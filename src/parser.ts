import { PublicKey } from "@solana/web3.js"
import { z } from "zod"

export const notEmptyStr = () =>
	z
		.string()
		.min(1)
		.transform(str => str.trim())

export const positiveNumber = () => z.number().positive()

export const pubkey = () =>
	z
		.string()
		.refine(str => {
			try {
				new PublicKey(str.trim())
				return true
			} catch {
				return false
			}
		}, "invalid pubkey")
		.transform(str => new PublicKey(str.trim()))
