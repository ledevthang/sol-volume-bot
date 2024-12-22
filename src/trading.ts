import { API_URLS, parseTokenAccountResp } from "@raydium-io/raydium-sdk-v2"
import {
	NATIVE_MINT,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID
} from "@solana/spl-token"
import {
	type Connection,
	type Keypair,
	Transaction,
	TransactionMessage,
	VersionedTransaction
} from "@solana/web3.js"
import axios from "axios"
import { Logger } from "./logger.js"
import type { SwapCompute, SwapParams } from "./types.js"

type Priority = {
	id: string
	success: boolean
	data: { default: { vh: number; h: number; m: number } }
}

type SwapTxResponse = {
	id: string
	version: string
	success: boolean
	msg?: string
	data: { transaction: string }[]
}

const fetchTokenAccountData = async (
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

export const apiSwap = async (
	connection: Connection,
	swapParams: SwapParams
) => {
	const { owner, inputMint, outputMint, amountIn, slippage } = swapParams

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
		throw new Error("insufficient tokens")
	}

	const { data: priority } = await axios.get<Priority>(
		`${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`
	)

	if (!priority.success) {
		throw new Error("Raydium error: can not get PRIORITY_FEE")
	}

	const { data: swapResponse } = await axios.get<SwapCompute>(
		`${
			API_URLS.SWAP_HOST
		}/compute/swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountIn.toString()}&slippageBps=${
			slippage * 100
		}&txVersion=${txVersion}`
	)

	if (!swapResponse.success) {
		throw new Error(`Raydium error: compute swap error ${swapResponse.msg}`)
	}

	const { data: swapTransactions } = await axios.post<SwapTxResponse>(
		`${API_URLS.SWAP_HOST}/transaction/swap-base-in`,
		{
			computeUnitPriceMicroLamports: String(priority.data.default.h),
			swapResponse,
			txVersion,
			wallet: owner.publicKey.toBase58(),
			wrapSol: isInputSol,
			unwrapSol: isOutputSol, // true means output mint receive sol, false means output mint received wsol
			inputAccount: isInputSol ? undefined : inputTokenAcc?.toBase58(),
			outputAccount: isOutputSol ? undefined : outputTokenAcc?.toBase58()
		}
	)

	if (!swapTransactions.success) {
		throw new Error(
			`Raydium error: get swap transaction error ${swapTransactions.msg}`
		)
	}

	const allTxBuf = swapTransactions.data.map(tx =>
		Buffer.from(tx.transaction, "base64")
	)
	const allTransactions = allTxBuf.map(txBuf => Transaction.from(txBuf))

	const instructions = []

	for (const tx of allTransactions) {
		instructions.push(...tx.instructions)
	}

	const block = await connection.getLatestBlockhash()

	const message = new TransactionMessage({
		instructions,
		payerKey: owner.publicKey,
		recentBlockhash: block.blockhash
	}).compileToV0Message()

	const transaction = new VersionedTransaction(message)

	transaction.sign([owner])

	const simulateResponse = await connection.simulateTransaction(transaction)

	if (simulateResponse.value.err) {
		throw new Error(
			`Simulate tx error: ${JSON.stringify(simulateResponse.value.err)}`
		)
	}

	const signature = await connection.sendTransaction(transaction)

	const result = await connection.confirmTransaction(
		{
			blockhash: block.blockhash,
			lastValidBlockHeight: block.lastValidBlockHeight,
			signature
		},
		"confirmed"
	)

	if (result.value.err)
		throw new Error(
			`Can not confirm transaction: ${JSON.stringify(simulateResponse.value.err)}`
		)

	Logger.info(`Confirmed transaction, tx: https://solscan.io/tx/${signature}`)

	return swapResponse.data.outputAmount
}
