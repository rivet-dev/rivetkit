import {
	type LevelWithSilent,
	type Logger,
	pino,
	stdTimeFunctions,
} from "pino";
import { z } from "zod";
import { getEnvUniversal } from "@/utils";

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

/**
 * Configure the default logger with optional log level.
 */
export function configureDefaultLogger(logLevel?: LogLevel): void {
	// Store the configured log level
	if (logLevel) {
		configuredLogLevel = logLevel;
	}

	// Timestamp config
	const enableTs = getEnvUniversal("LOG_TIMESTAMP") === "1";

	baseLogger = pino({
		level: getPinoLevel(logLevel),
		messageKey: "msg",
		// Do not include pid/hostname in output
		base: {},
		// Keep a string level in the output
		formatters: {
			level(label) {
				return { level: label.toUpperCase() } as Record<string, unknown>;
			},
		},
		timestamp: enableTs ? stdTimeFunctions.isoTime : false,
		transport: {
			target: "pino-logfmt",
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
