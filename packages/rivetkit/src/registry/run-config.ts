import type { cors } from "hono/cors";
import type { Logger } from "pino";
import { z } from "zod";
import type { ActorDriverBuilder } from "@/actor/driver";
import { ClientConfigSchema } from "@/client/config";
import { LogLevelSchema } from "@/common/log";
import { InspectorConfigSchema } from "@/inspector/config";
import type { ManagerDriverBuilder } from "@/manager/driver";

type CorsOptions = NonNullable<Parameters<typeof cors>[0]>;

export const DriverConfigSchema = z.object({
	/** Machine-readable name to identify this driver by. */
	name: z.string(),
	manager: z.custom<ManagerDriverBuilder>(),
	actor: z.custom<ActorDriverBuilder>(),
});

export type DriverConfig = z.infer<typeof DriverConfigSchema>;

/** Base config used for the actor config across all platforms. */
export const RunConfigSchema = ClientConfigSchema.extend({
	driver: DriverConfigSchema.optional(),

	/** CORS configuration for the router. Uses Hono's CORS middleware options. */
	cors: z.custom<CorsOptions>().optional(),

	maxIncomingMessageSize: z.number().optional().default(65_536),

	inspector: InspectorConfigSchema,

	/** @experimental */
	disableServer: z.boolean().optional().default(false),

	/** @experimental */
	disableActorDriver: z.boolean().optional().default(false),

	/**
	 * @experimental
	 *
	 * Base path for the router. This is used to prefix all routes.
	 * For example, if the base path is `/api`, then the route `/actors` will be
	 * available at `/api/actors`.
	 */
	basePath: z.string().optional().default("/"),

	/**
	 * @experimental
	 *
	 * Disable welcome message.
	 * */
	noWelcome: z.boolean().optional().default(false),

	/**
	 * @experimental
	 * */
	logging: z
		.object({
			baseLogger: z.custom<Logger>().optional(),
			level: LogLevelSchema.optional(),
		})
		.optional()
		.default({}),
}).default({});

export type RunConfig = z.infer<typeof RunConfigSchema>;
export type RunConfigInput = z.input<typeof RunConfigSchema>;
