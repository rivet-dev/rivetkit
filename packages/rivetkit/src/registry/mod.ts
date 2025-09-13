import type { Hono } from "hono";
import { type Client, createClientWithDriver } from "@/client/client";
import {
	configureBaseLogger,
	configureDefaultLogger,
	getPinoLevel,
} from "@/common/log";
import { chooseDefaultDriver } from "@/drivers/default";
import { createInlineClientDriver } from "@/inline-client-driver/mod";
import { getInspectorUrl } from "@/inspector/utils";
import { createManagerRouter } from "@/manager/router";
import {
	type RegistryActors,
	type RegistryConfig,
	type RegistryConfigInput,
	RegistryConfigSchema,
} from "./config";
import { logger } from "./log";
import {
	type DriverConfig,
	type RunConfig,
	type RunConfigInput,
	RunConfigSchema,
} from "./run-config";
import { crossPlatformServe } from "./serve";

interface ServerOutput<A extends Registry<any>> {
	client: Client<A>;
	hono: Hono;
	handler: (req: Request) => Promise<Response>;
	serve: (hono?: Hono) => void;
}

export class Registry<A extends RegistryActors> {
	#config: RegistryConfig;

	public get config(): RegistryConfig {
		return this.#config;
	}

	constructor(config: RegistryConfig) {
		this.#config = config;
	}

	/**
	 * Runs the registry for a server.
	 */
	public createServer(inputConfig?: RunConfigInput): ServerOutput<this> {
		const config = RunConfigSchema.parse(inputConfig);

		// Configure logger
		if (config.logging?.baseLogger) {
			// Use provided base logger
			configureBaseLogger(config.logging.baseLogger);
		} else {
			// Configure default logger with log level from config
			// getPinoLevel will handle env variable priority
			configureDefaultLogger(config.logging?.level);
		}

		// Choose the driver based on configuration
		const driver = chooseDefaultDriver(config);

		// Configure getUpgradeWebSocket lazily so we can assign it in crossPlatformServe
		let upgradeWebSocket: any;
		if (!config.getUpgradeWebSocket) {
			config.getUpgradeWebSocket = () => upgradeWebSocket!;
		}

		// Create router
		const managerDriver = driver.manager(this.#config, config);
		const clientDriver = createInlineClientDriver(managerDriver);
		const { router: hono } = createManagerRouter(
			this.#config,
			config,
			clientDriver,
			managerDriver,
			false,
		);

		// Create client
		const client = createClientWithDriver<this>(clientDriver);

		const driverLog = managerDriver.extraStartupLog?.() ?? {};
		logger().info({
			msg: "rivetkit ready",
			driver: driver.name,
			definitions: Object.keys(this.#config.use).length,
			...driverLog,
		});
		if (config.inspector?.enabled) {
			logger().info({ msg: "inspector ready", url: getInspectorUrl(config) });
		}

		// Create runner
		if (config.role === "all" || config.role === "runner") {
			const inlineClient = createClientWithDriver(
				createInlineClientDriver(managerDriver),
			);
			const _actorDriver = driver.actor(
				this.#config,
				config,
				managerDriver,
				inlineClient,
			);
			// TODO: What do we do with the actor driver here?
		}

		return {
			client,
			hono,
			handler: async (req: Request) => await hono.fetch(req),
			serve: async (app) => {
				const out = await crossPlatformServe(hono, app);
				upgradeWebSocket = out.upgradeWebSocket;
			},
		};
	}

	/**
	 * Runs the registry as a standalone server.
	 */
	public async runServer(inputConfig?: RunConfigInput) {
		const { serve } = this.createServer(inputConfig);
		serve();
	}
}

export function setup<A extends RegistryActors>(
	input: RegistryConfigInput<A>,
): Registry<A> {
	const config = RegistryConfigSchema.parse(input);
	return new Registry(config);
}

export type { RegistryConfig, RegistryActors, RunConfig, DriverConfig };
export { RegistryConfigSchema };
