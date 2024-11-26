import { NATIVE_MINT } from "@solana/spl-token"
import { owner } from "./config.js"
import { apiSwap } from "./trading.js"

async function main() {
	await apiSwap({
		owner,
		inputMint: NATIVE_MINT.toBase58(),
		outputMint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
		amountIn: 100,
		slippage: 0.5
	})
}

main()
