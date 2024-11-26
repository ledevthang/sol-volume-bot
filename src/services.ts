import type { PublicKey } from "@solana/web3.js"
import axios from "axios"

type GetPriceResponse = {
	data: Record<string, string>
}

export async function getPrice(tokens: PublicKey[]) {
	const response = await axios.get<GetPriceResponse>(
		"https://api-v3.raydium.io/mint/price",
		{
			params: {
				mints: tokens.map(token => token.toBase58()).join(",")
			}
		}
	)

	return response.data.data
}
