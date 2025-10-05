import invariant from "invariant";
import { type Client, createClientWithDriver } from "@/client/client";
import { configureBaseLogger, configureDefaultLogger } from "@/common/log";
import type { ActorDriver } from "@/driver-helpers/mod";
import { chooseDefaultDriver } from "@/drivers/default";
import { ENGINE_ENDPOINT, ensureEngineProcess } from "@/engine-process/mod";
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
	type RunnerConfig,
	type RunnerConfigInput,
	RunnerConfigSchema,
} from "./run-config";
import { crossPlatformServe } from "./serve";

export type ServerlessActorDriverBuilder = (
	token?: string,
	totalSlots?: number,
	runnerName?: string,
	namespace?: string,
) => ActorDriver;

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
	public start(inputConfig?: RunnerConfigInput): ServerOutput<this> {
		const config = RunnerConfigSchema.parse(inputConfig);

		// Promise for any async operations we need to wait to complete
		const readyPromises = [];

		// Start engine
		if (config.runEngine) {
			logger().debug({
				msg: "run engine requested",
				version: config.runEngineVersion,
			});

			// Set config to point to the engine
			config.disableDefaultServer = true;
			config.overrideServerAddress = ENGINE_ENDPOINT;
			invariant(
				config.endpoint === undefined,
				"cannot specify 'endpoint' with 'runEngine'",
			);
			config.endpoint = ENGINE_ENDPOINT;

			// Start the engine
			const engineProcessPromise = ensureEngineProcess({
				version: config.runEngineVersion,
			});

			// Chain ready promise
			readyPromises.push(engineProcessPromise);
		}

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
			config.disableDefaultServer = true;
		}
		if (driver.name === "cloudflare-workers") {
			config.inspector.enabled = { manager: false, actor: true };
			config.disableDefaultServer = true;
			config.disableActorDriver = true;
			config.noWelcome = true;
		}
		if (config.runnerKind === "serverless") {
			config.disableActorDriver = true;
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
			if (!config.disableDefaultServer) {
				console.log(`  - Endpoint:     ${config.endpoint}`);
			} else if (config.overrideServerAddress) {
				console.log(`  - Endpoint:     ${config.overrideServerAddress}`);
			}
			if (config.runEngine) {
				const padding = " ".repeat(Math.max(0, 13 - "Engine".length));
				console.log(`  - Engine:${padding}v${config.runEngineVersion}`);
			}
			for (const [k, v] of Object.entries(displayInfo.properties)) {
				const padding = " ".repeat(Math.max(0, 13 - k.length));
				console.log(`  - ${k}:${padding}${v}`);
			}
			if (isInspectorEnabled(config, "manager") && managerDriver.inspector) {
				console.log(`  - Inspector:    ${getInspectorUrl(config)}`);
			}
			console.log();
		}

		let serverlessActorDriverBuilder: undefined | ServerlessActorDriverBuilder;
		// HACK: We need to find a better way to let the driver itself decide when to start the actor driver
		// Create runner
		//
		// Even though we do not use the return value, this is required to start the code that will handle incoming actors
		if (!config.disableActorDriver) {
			Promise.all(readyPromises).then(() => {
				logger().debug("ready promises finished, starting actor driver");

				driver.actor(this.#config, config, managerDriver, client);
			});
		} else {
			serverlessActorDriverBuilder = (
				token,
				totalSlots,
				runnerName,
				namespace,
			) => {
				// Override config
				if (token) config.token = token;
				if (totalSlots) config.totalSlots = totalSlots;
				if (runnerName) config.runnerName = runnerName;
				if (namespace) config.namespace = namespace;

				// Create new actor driver with updated config
				return driver.actor(this.#config, config, managerDriver, client);
			};
		}

		const { router: hono } = createManagerRouter(
			this.#config,
			config,
			managerDriver,
			serverlessActorDriverBuilder,
		);

		// Start server
		if (!config.disableDefaultServer) {
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
	RunnerConfig as RunConfig,
	RunnerConfigInput as RunConfigInput,
	DriverConfig,
};
export { RegistryConfigSchema };
