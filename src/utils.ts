import * as web3 from "@solana/web3.js"
import { isAxiosError } from "axios"
import { Decimal } from "decimal.js"
import { Logger } from "./logger.js"

export function sleep(duration: number) {
	return new Promise(res => setTimeout(res, duration))
}

export function parseSol(amount: number) {
	return BigInt(
		new Decimal(amount).mul(web3.LAMPORTS_PER_SOL).floor().toFixed()
	)
}

export function parseToken(amount: number, decimals: number) {
	return BigInt(
		new Decimal(amount)
			.mul(10 ** decimals)
			.floor()
			.toFixed()
	)
}

export function formatSol(lamports: bigint) {
	return new Decimal(lamports.toString()).div(web3.LAMPORTS_PER_SOL).toFixed()
}

export function formatToken(amount: bigint, decimals: number) {
	return new Decimal(amount.toString()).div(10 ** decimals).toFixed()
}

export function bigintPercent(value: bigint, percent: number) {
	return (value / 100n) * BigInt(percent)
}

// The maximum is exclusive and the minimum is inclusive
export function random(min: number, max: number) {
	return Math.random() * (max - min) + min
}

export function logError(error: any) {
	if (isAxiosError(error)) {
		Logger.error(
			`Http request Error: ${JSON.stringify(
				{
					code: error.code,
					message: error.message,
					response: error.response?.data
				},
				null,
				1
			)}`
		)
	} else if (error?.message) {
		Logger.error(
			`RPC request error: ${JSON.stringify(
				{
					name: error?.name,
					message: error?.message
				},
				null,
				1
			)}`
		)
	} else {
		Logger.error(error)
	}
}

// function isInsufficientError(error: any) {
// 	if (error?.message?.includes("insufficient lamports")) return true

// 	if (error?.message?.includes("insufficient tokens")) return true

// 	if (error?.message?.includes("insufficient funds")) return true

// 	return false
// }
