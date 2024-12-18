import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Keypair } from "@solana/web3.js"

export type SwapParams = {
	owner: Keypair
	inputMint: string
	outputMint: string
	amountIn: bigint //
	slippage: number // 0.5 => 0.5%
}

export interface SwapCompute {
	id: string
	success: true
	version: "V0" | "V1"
	openTime?: undefined
	msg?: string
	data: {
		swapType: "BaseIn" | "BaseOut"
		inputMint: string
		inputAmount: string
		outputMint: string
		outputAmount: string
		otherAmountThreshold: string
		slippageBps: number
		priceImpactPct: number
		routePlan: {
			poolId: string
			inputMint: string
			outputMint: string
			feeMint: string
			feeRate: number
			feeAmount: string
		}[]
	}
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

console.log(process.cwd())
