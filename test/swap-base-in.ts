import {
	Connection,
	Keypair,
	Transaction,
	VersionedTransaction,
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
	const outputMint = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" // RAY
	const amount = 100
	const slippage = 0.5 // in percent, for this example, 0.5 means 0.5%
	const txVersion: string = "LEGACY" // or LEGACY
	const isV0Tx = txVersion === "V0"

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

	const allTxBuf = swapTransactions.data.map(tx =>
		Buffer.from(tx.transaction, "base64")
	)
	const allTransactions = allTxBuf.map(txBuf =>
		isV0Tx ? VersionedTransaction.deserialize(txBuf) : Transaction.from(txBuf)
	)

	console.log(`total ${allTransactions.length} transactions`, swapTransactions)

	let idx = 0
	if (!isV0Tx) {
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
			console.log(`${++idx} transaction confirmed, txId: ${txId}`)
		}
	} else {
		for (const tx of allTransactions) {
			idx++
			const transaction = tx as VersionedTransaction
			transaction.sign([owner])
			const txId = await connection.sendTransaction(
				tx as VersionedTransaction,
				{ skipPreflight: true }
			)
			const { lastValidBlockHeight, blockhash } =
				await connection.getLatestBlockhash({
					commitment: "finalized"
				})
			console.log(`${idx} transaction sending..., txId: ${txId}`)
			await connection.confirmTransaction(
				{
					blockhash,
					lastValidBlockHeight,
					signature: txId
				},
				"confirmed"
			)
			console.log(`${idx} transaction confirmed`)
		}
	}
}
apiSwap()
