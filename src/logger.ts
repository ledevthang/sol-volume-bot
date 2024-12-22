import { DateTime } from "luxon"

export abstract class Logger {
	static info(...args: unknown[]) {
		console.info(`[INFO] [${DateTime.now().toISO()}]`, ...args)
	}

	static error(...args: unknown[]) {
		console.error(`[ERROR] [${DateTime.now().toISO()}]`, ...args)
	}

	static newLine() {
		console.log("")
	}
}
