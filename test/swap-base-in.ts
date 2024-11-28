import {
	Connection,
	Keypair,
	Transaction,
	sendAndConfirmTransaction
} from "@solana/web3.js"
import {
	NATIVE_MINT,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID
} from "@solana/spl-token"
import axios from "axios"
import { API_URLS, parseTokenAccountResp } from "@raydium-io/raydium-sdk-v2"
import fs from "node:fs"

interface SwapCompute {
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

const connection = new Connection(
	"https://api.mainnet-beta.solana.com",
	"confirmed"
)
const owner = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(fs.readFileSync("id.json", "utf-8")))
)

export const fetchTokenAccountData = async (
	connection: Connection,
	owner: Keypair
) => {
	const solAccountResp = await connection.getAccountInfo(owner.publicKey)
	const tokenAccountResp = await connection.getTokenAccountsByOwner(
		owner.publicKey,
		{ programId: TOKEN_PROGRAM_ID }
	)
	const token2022Req = await connection.getTokenAccountsByOwner(
		owner.publicKey,
		{ programId: TOKEN_2022_PROGRAM_ID }
	)
	const tokenAccountData = parseTokenAccountResp({
		owner: owner.publicKey,
		solAccountResp,
		tokenAccountResp: {
			context: tokenAccountResp.context,
			value: [...tokenAccountResp.value, ...token2022Req.value]
		}
	})
	return tokenAccountData
}

export const apiSwap = async () => {
	const inputMint = NATIVE_MINT.toBase58()
	const outputMint = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"
	const amount = 100
	const slippage = 5 // in percent, for this example, 0.5 means 0.5%
	const txVersion: string = "LEGACY" // or LEGACY

	const [isInputSol, isOutputSol] = [
		inputMint === NATIVE_MINT.toBase58(),
		outputMint === NATIVE_MINT.toBase58()
	]

	const { tokenAccounts } = await fetchTokenAccountData(connection, owner)
	const inputTokenAcc = tokenAccounts.find(
		a => a.mint.toBase58() === inputMint
	)?.publicKey
	const outputTokenAcc = tokenAccounts.find(
		a => a.mint.toBase58() === outputMint
	)?.publicKey

	if (!inputTokenAcc && !isInputSol) {
		console.error("do not have input token account")
		return
	}

	// get statistical transaction fee from api
	/**
	 * vh: very high
	 * h: high
	 * m: medium
	 */
	const { data } = await axios.get<{
		id: string
		success: boolean
		data: { default: { vh: number; h: number; m: number } }
	}>(`${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`)

	const { data: swapResponse } = await axios.get<SwapCompute>(
		`${
			API_URLS.SWAP_HOST
		}/compute/swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${
			slippage * 100
		}&txVersion=${txVersion}`
	)

	console.log("swapResponse: ", swapResponse)

	if (!swapResponse.success) {
		throw new Error("INSUFFICIENT_LIQUIDITY")
	}

	const { data: swapTransactions } = await axios.post<{
		id: string
		version: string
		success: boolean
		data: { transaction: string }[]
	}>(`${API_URLS.SWAP_HOST}/transaction/swap-base-in`, {
		computeUnitPriceMicroLamports: String(data.data.default.h),
		swapResponse,
		txVersion,
		wallet: owner.publicKey.toBase58(),
		wrapSol: isInputSol,
		unwrapSol: isOutputSol, // true means output mint receive sol, false means output mint received wsol
		inputAccount: isInputSol ? undefined : inputTokenAcc?.toBase58(),
		outputAccount: isOutputSol ? undefined : outputTokenAcc?.toBase58()
	})

	console.log("swapTransactions: ", swapTransactions)

	if (!swapTransactions.success) {
		throw new Error("INSUFFICIENT_LIQUIDITY")
	}

	const allTxBuf = swapTransactions.data.map(tx =>
		Buffer.from(tx.transaction, "base64")
	)
	const allTransactions = allTxBuf.map(txBuf => Transaction.from(txBuf))

	let idx = 0
	for (const tx of allTransactions) {
		console.log(`${++idx} transaction sending...`)
		const transaction = tx as Transaction
		transaction.sign(owner)
		const txId = await sendAndConfirmTransaction(
			connection,
			transaction,
			[owner],
			{ skipPreflight: true }
		)
		console.log(
			`${++idx} transaction confirmed, tx: https://solscan.io/tx/${txId}`
		)
	}
}
apiSwap()
