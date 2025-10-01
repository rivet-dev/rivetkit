import { type Client, createClientWithDriver } from "@/client/client";
import { configureBaseLogger, configureDefaultLogger } from "@/common/log";
import type { ActorDriver } from "@/driver-helpers/mod";
import { chooseDefaultDriver } from "@/drivers/default";
import {
	configureInspectorAccessToken,
	getInspectorUrl,
	isInspectorEnabled,
} from "@/inspector/utils";
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
	/** Client to communicate with the actors. */
	client: Client<A>;
	/** Fetch handler to manually route requests to the Rivet manager API. */
	fetch: (request: Request, ...args: any) => Response | Promise<Response>;
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
	public start(inputConfig?: RunConfigInput): ServerOutput<this> {
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
			config.inspector.enabled = { manager: false, actor: true };
			config.disableServer = true;
		}
		if (driver.name === "cloudflare-workers") {
			config.inspector.enabled = { manager: false, actor: true };
			config.disableServer = true;
			config.disableActorDriver = true;
			config.noWelcome = true;
		}

		// Configure getUpgradeWebSocket lazily so we can assign it in crossPlatformServe
		let upgradeWebSocket: any;
		if (!config.getUpgradeWebSocket) {
			config.getUpgradeWebSocket = () => upgradeWebSocket!;
		}

		// Create router
		const managerDriver = driver.manager(this.#config, config);
		configureInspectorAccessToken(config, managerDriver);

		// Create client
		const client = createClientWithDriver<this>(managerDriver, config);

		const driverLog = managerDriver.extraStartupLog?.() ?? {};
		logger().info({
			msg: "rivetkit ready",
			driver: driver.name,
			definitions: Object.keys(this.#config.use).length,
			...driverLog,
		});
		if (isInspectorEnabled(config, "manager") && managerDriver.inspector) {
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
			if (isInspectorEnabled(config, "manager") && managerDriver.inspector) {
				console.log(`  - Inspector:     ${getInspectorUrl(config)}`);
			}
			console.log();
		}

		// HACK: We need to find a better way to let the driver itself decide when to start the actor driver
		// Create runner
		//
		// Even though we do not use the return value, this is required to start the code that will handle incoming actors
		if (!config.disableActorDriver) {
			const _actorDriver = driver.actor(
				this.#config,
				config,
				managerDriver,
				client,
			);
		}

		const { router: hono } = createManagerRouter(
			this.#config,
			config,
			managerDriver,
			undefined,
		);

		// Start server
		if (!config.disableServer) {
			(async () => {
				const out = await crossPlatformServe(hono, undefined);
				upgradeWebSocket = out.upgradeWebSocket;
			})();
		}

		return {
			client,
			fetch: hono.fetch.bind(hono),
		};
	}

	public startServerless(inputConfig?: RunConfigInput): ServerOutput<this> {
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
			config.disableServer = true;
			config.disableActorDriver = true;
		}
		if (driver.name === "cloudflare-workers") {
			config.inspector.enabled = false;
			config.disableServer = true;
			config.disableActorDriver = true;
			config.noWelcome = true;
		}

		// Configure getUpgradeWebSocket lazily so we can assign it in crossPlatformServe
		let upgradeWebSocket: any;
		if (!config.getUpgradeWebSocket) {
			config.getUpgradeWebSocket = () => upgradeWebSocket!;
		}

		// Create router
		const managerDriver = driver.manager(this.#config, config);

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

		let serverlessActorDriverBuilder:
			| ((token?: string) => ActorDriver)
			| undefined = (token: string | undefined) => {
			// Override config token if one was set
			if (token) config.token = token;

			return driver.actor(this.#config, config, managerDriver, client);
		};

		// HACK: We need to find a better way to let the driver itself decide when to start the actor driver
		// Create runner
		//
		// Even though we do not use the return value, this is required to start the code that will handle incoming actors
		if (!config.disableActorDriver) {
			const _actorDriver = serverlessActorDriverBuilder();
			serverlessActorDriverBuilder = undefined;
		}

		const { router: hono } = createManagerRouter(
			this.#config,
			config,
			managerDriver,
			serverlessActorDriverBuilder,
		);

		// Start server
		if (!config.disableServer) {
			(async () => {
				const out = await crossPlatformServe(hono, undefined);
				upgradeWebSocket = out.upgradeWebSocket;
			})();
		}

		return {
			client,
			fetch: hono.fetch.bind(hono),
		};
	}
}

export function setup<A extends RegistryActors>(
	input: RegistryConfigInput<A>,
): Registry<A> {
	const config = RegistryConfigSchema.parse(input);
	return new Registry(config);
}

export type {
	RegistryConfig,
	RegistryActors,
	RunConfig,
	RunConfigInput,
	DriverConfig,
};
export { RegistryConfigSchema };
