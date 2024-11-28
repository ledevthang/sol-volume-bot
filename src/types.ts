import type { Keypair } from "@solana/web3.js"

export type VolumeBotConfig = {
	inputMint: string
	outputMint: string
	numberOfTradesPerWallet: number
	initTokensPerWallet: number
	initSolPerWallet: number
	interval: number // elapse time after each trade
	amountTransferPercent: number
	walletsConcurrency: number
}

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
