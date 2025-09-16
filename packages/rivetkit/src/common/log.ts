import {
	type LevelWithSilent,
	type Logger,
	pino,
	stdTimeFunctions,
} from "pino";
import { z } from "zod";
import { getEnvUniversal } from "@/utils";
import {
	castToLogValue,
	formatTimestamp,
	LOGGER_CONFIG,
	stringify,
} from "./logfmt";

export type { Logger } from "pino";

let baseLogger: Logger | undefined;
let configuredLogLevel: LogLevel | undefined;

/** Cache of child loggers by logger name. */
const loggerCache = new Map<string, Logger>();

export const LogLevelSchema = z.enum([
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"silent",
]);

export type LogLevel = z.infer<typeof LogLevelSchema>;

export function getPinoLevel(logLevel?: LogLevel): LevelWithSilent {
	// Priority: provided > configured > env > default
	if (logLevel) {
		return logLevel;
	}

	if (configuredLogLevel) {
		return configuredLogLevel;
	}

	const raw = (getEnvUniversal("LOG_LEVEL") || "warn").toString().toLowerCase();

	const parsed = LogLevelSchema.safeParse(raw);
	if (parsed.success) {
		return parsed.data;
	}

	// Default to info if invalid
	return "info";
}

export function getIncludeTarget(): boolean {
	return getEnvUniversal("LOG_TARGET") === "1";
}

/**
 * Configure a custom base logger.
 */
export function configureBaseLogger(logger: Logger): void {
	baseLogger = logger;
	loggerCache.clear();
}

// TODO: This can be simplified in logfmt.ts
function customWrite(level: string, o: any) {
	const entries: any = {};

	// Add timestamp if enabled
	if (getEnvUniversal("LOG_TIMESTAMP") === "1" && o.time) {
		const date = typeof o.time === "number" ? new Date(o.time) : new Date();
		entries.ts = formatTimestamp(date);
	}

	// Add level
	entries.level = level.toUpperCase();

	// Add target if present
	if (o.target) {
		entries.target = o.target;
	}

	// Add message
	if (o.msg) {
		entries.msg = o.msg;
	}

	// Add other properties
	for (const [key, value] of Object.entries(o)) {
		if (
			key !== "time" &&
			key !== "level" &&
			key !== "target" &&
			key !== "msg" &&
			key !== "pid" &&
			key !== "hostname"
		) {
			entries[key] = castToLogValue(value);
		}
	}

	const output = stringify(entries);
	console.log(output);
}

/**
 * Configure the default logger with optional log level.
 */
export async function configureDefaultLogger(
	logLevel?: LogLevel,
): Promise<void> {
	// Store the configured log level
	if (logLevel) {
		configuredLogLevel = logLevel;
	}

	baseLogger = pino({
		level: getPinoLevel(logLevel),
		messageKey: "msg",
		// Do not include pid/hostname in output
		base: {},
		// Keep a string level in the output
		formatters: {
			level(_label: string, number: number) {
				return { level: number };
			},
		},
		timestamp:
			getEnvUniversal("LOG_TIMESTAMP") === "1"
				? stdTimeFunctions.epochTime
				: false,
		browser: {
			write: {
				fatal: customWrite.bind(null, "fatal"),
				error: customWrite.bind(null, "error"),
				warn: customWrite.bind(null, "warn"),
				info: customWrite.bind(null, "info"),
				debug: customWrite.bind(null, "debug"),
				trace: customWrite.bind(null, "trace"),
			},
		},
		hooks: {
			logMethod(inputArgs, _method, level) {
				// TODO: This is a hack to not implement our own transport target. We can get better perf if we have our own transport target.

				const levelMap: Record<number, string> = {
					10: "trace",
					20: "debug",
					30: "info",
					40: "warn",
					50: "error",
					60: "fatal",
				};
				const levelName = levelMap[level] || "info";
				const time =
					getEnvUniversal("LOG_TIMESTAMP") === "1" ? Date.now() : undefined;
				// TODO: This can be simplified in logfmt.ts
				if (inputArgs.length >= 2) {
					const [objOrMsg, msg] = inputArgs;
					if (typeof objOrMsg === "object" && objOrMsg !== null) {
						customWrite(levelName, { ...objOrMsg, msg, time });
					} else {
						customWrite(levelName, { msg: String(objOrMsg), time });
					}
				} else if (inputArgs.length === 1) {
					const [objOrMsg] = inputArgs;
					if (typeof objOrMsg === "object" && objOrMsg !== null) {
						customWrite(levelName, { ...objOrMsg, time });
					} else {
						customWrite(levelName, { msg: String(objOrMsg), time });
					}
				}
			},
		},
	});

	loggerCache.clear();
}

/**
 * Get or initialize the base logger.
 */
export function getBaseLogger(): Logger {
	if (!baseLogger) {
		configureDefaultLogger();
	}
	return baseLogger!;
}

/**
 * Returns a child logger with `target` bound for the given name.
 */
export function getLogger(name = "default"): Logger {
	// Check cache first
	const cached = loggerCache.get(name);
	if (cached) {
		return cached;
	}

	// Create
	const base = getBaseLogger();

	// Add target to log if enabled
	const child = getIncludeTarget() ? base.child({ target: name }) : base;

	// Cache the logger
	loggerCache.set(name, child);

	return child;
}
