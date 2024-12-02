import * as web3 from "@solana/web3.js"
import { isAxiosError } from "axios"
import { Decimal } from "decimal.js"
import { retry } from "ts-retry-promise"

export function sleep(duration: number) {
	return new Promise(res => setTimeout(res, duration))
}

export function parseSol(amount: number) {
	return BigInt(Math.floor(amount * web3.LAMPORTS_PER_SOL))
}

export function parseToken(amount: number, decimals: number) {
	return BigInt(Math.floor(amount * 10 ** decimals))
}

export function formatSol(lamports: bigint) {
	return new Decimal(lamports.toString()).div(web3.LAMPORTS_PER_SOL).toNumber()
}

export function formatToken(amount: bigint, decimals: number) {
	return new Decimal(amount.toString()).div(10 ** decimals).toNumber()
}

export function percent(value: number, percent: number) {
	return (value / 100) * percent
}

export function bigintPercent(value: bigint, percent: number) {
	return (value / 100n) * BigInt(percent)
}

export async function tryToInsufficient<T>(
	thunk: () => Promise<T>
): Promise<T> {
	return retry(thunk, {
		timeout: "INFINITELY",
		retries: "INFINITELY",
		delay: 5_000,
		retryIf: error => {
			if (isAxiosError(error)) {
				console.error(
					`Raydium request Error: ${JSON.stringify(
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
				console.error(
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
				console.error(error)
			}

			return !isInsufficientError(error)
		}
	})
}

export function isInsufficientError(error: any) {
	if (error?.message?.includes("insufficient lamports")) return true

	if (error?.message?.includes("insufficient tokens")) return true

	if (error?.message?.includes("insufficient funds")) return true

	if (error?.message?.includes("Raydium swap")) return true

	return false
}
