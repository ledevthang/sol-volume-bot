import { DateTime } from "luxon"

export abstract class Logger {
	static info(...args: unknown[]) {
		console.info(
			`[INFO] [${DateTime.now().toFormat("yyyy/mm/dd HH:MM:ss")}]`,
			...args
		)
	}

	static error(...args: unknown[]) {
		console.error(
			`[ERROR] [${DateTime.now().toFormat("yyyy/mm/dd HH:MM:ss")}]`,
			...args
		)
	}

	static newLine() {
		console.log("")
	}
}
