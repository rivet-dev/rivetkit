import type { cors } from "hono/cors";
import type { Logger } from "pino";
import { z } from "zod";
import type { ActorDriverBuilder } from "@/actor/driver";
import { LogLevelSchema } from "@/common/log";
import { EngingConfigSchema as EngineConfigSchema } from "@/drivers/engine/config";
import { InspectorConfigSchema } from "@/inspector/config";
import type { ManagerDriverBuilder } from "@/manager/driver";
import type { GetUpgradeWebSocket } from "@/utils";
import { getEnvUniversal } from "@/utils";

type CorsOptions = NonNullable<Parameters<typeof cors>[0]>;

export const DriverConfigSchema = z.object({
	/** Machine-readable name to identify this driver by. */
	name: z.string(),
	manager: z.custom<ManagerDriverBuilder>(),
	actor: z.custom<ActorDriverBuilder>(),
});

export type DriverConfig = z.infer<typeof DriverConfigSchema>;

/** Base config used for the actor config across all platforms. */
export const RunnerConfigSchema = z
	.object({
		driver: DriverConfigSchema.optional(),

		/** CORS configuration for the router. Uses Hono's CORS middleware options. */
		cors: z.custom<CorsOptions>().optional(),

		/** @experimental */
		maxIncomingMessageSize: z.number().optional().default(65_536),

		/** @experimental */
		inspector: InspectorConfigSchema,

		/** @experimental */
		disableDefaultServer: z.boolean().optional().default(false),

		/** @experimental */
		overrideServerAddress: z.string().optional(),

		/** @experimental */
		disableActorDriver: z.boolean().optional().default(false),

		/**
		 * @experimental
		 *
		 * Whether to run runners normally or have them managed
		 * serverlessly (by the Rivet Engine for example).
		 */
		runnerKind: z
			.enum(["serverless", "normal"])
			.optional()
			.default(() =>
				getEnvUniversal("RIVET_RUNNER_KIND") === "serverless"
					? "serverless"
					: "normal",
			),
		totalSlots: z.number().optional(),

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

		// This is a function to allow for lazy configuration of upgradeWebSocket on the
		// fly. This is required since the dependencies that upgradeWebSocket
		// (specifically Node.js) can sometimes only be specified after the router is
		// created or must be imported async using `await import(...)`
		getUpgradeWebSocket: z.custom<GetUpgradeWebSocket>().optional(),
	})
	.merge(EngineConfigSchema.removeDefault())
	.default({});

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;
export type RunnerConfigInput = z.input<typeof RunnerConfigSchema>;
