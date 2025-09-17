import type { Hono } from "hono";
import { RunConfigSchema } from "rivetkit/driver-helpers";
import { z } from "zod";

export const ConfigSchema = RunConfigSchema.removeDefault()
	.omit({ driver: true, getUpgradeWebSocket: true })
	.extend({
		/** Path that the Rivet manager API will be mounted. */
		managerPath: z.string().optional().default("/rivet"),

		fetch: z.custom<ExportedHandlerFetchHandler<unknown, unknown>>().optional(),
	})
	.default({});
export type InputConfig = z.input<typeof ConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
