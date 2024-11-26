export type VolumeBotConfig = {
	inputMint: string
	outputMint: string
	numberOfOrders: number
	minQuantity: number
	maxQuantity: number
	interval: number
}

export type SwapParams = {
	inputMint: string
	outputMint: string
	amountIn: number //
	slippage: number // 0.5 => 0.5%
}

export interface SwapCompute {
	id: string
	success: true
	version: "V0" | "V1"
	openTime?: undefined
	msg: undefined
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
