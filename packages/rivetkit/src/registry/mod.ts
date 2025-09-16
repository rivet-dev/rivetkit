import type { Hono } from "hono";
import { type Client, createClientWithDriver } from "@/client/client";
import { configureBaseLogger, configureDefaultLogger } from "@/common/log";
import { chooseDefaultDriver } from "@/drivers/default";
import { getInspectorUrl } from "@/inspector/utils";
import { createManagerRouter } from "@/manager/router";
import pkg from "../../package.json" with { type: "json" };
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
	config: RunConfig;
	driver: DriverConfig;
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

		// TODO: Find cleaner way of disabling by default
		if (driver.name === "engine") {
			config.inspector.enabled = false;
		}

		// Configure getUpgradeWebSocket lazily so we can assign it in crossPlatformServe
		let upgradeWebSocket: any;
		if (!config.getUpgradeWebSocket) {
			config.getUpgradeWebSocket = () => upgradeWebSocket!;
		}

		// Create router
		const managerDriver = driver.manager(this.#config, config);
		const { router: hono } = createManagerRouter(
			this.#config,
			config,
			managerDriver,
			false,
		);

		// Create client
		const client = createClientWithDriver<this>(managerDriver, config);

		const driverLog = managerDriver.extraStartupLog?.() ?? {};
		logger().info({
			msg: "rivetkit ready",
			driver: driver.name,
			definitions: Object.keys(this.#config.use).length,
			...driverLog,
		});
		if (config.inspector?.enabled && managerDriver.inspector) {
			logger().info({ msg: "inspector ready", url: getInspectorUrl(config) });
		}

		// Print welcome information
		if (!config.noWelcome) {
			const displayInfo = managerDriver.displayInformation();
			console.log();
			console.log(`  RivetKit ${pkg.version} (${displayInfo.name})`);
			console.log(`  - Endpoint:     http://127.0.0.1:6420`);
			for (const [k, v] of Object.entries(displayInfo.properties)) {
				const padding = " ".repeat(Math.max(0, 13 - k.length));
				console.log(`  - ${k}:${padding}${v}`);
			}
			if (config.inspector?.enabled && managerDriver.inspector) {
				console.log(`  - Inspector:    ${getInspectorUrl(config)}`);
			}
			console.log();
		}

		// Create runner
		//
		// Even though we do not use the return value, this is required to start the code that will handle incoming actors
		const _actorDriver = driver.actor(
			this.#config,
			config,
			managerDriver,
			client,
		);

		return {
			config,
			driver,
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
		const { driver, serve } = this.createServer(inputConfig);

		// TODO: FInd better way of doing this
		// Don't run server by default
		if (driver.name !== "engine") {
			serve();
		}
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
