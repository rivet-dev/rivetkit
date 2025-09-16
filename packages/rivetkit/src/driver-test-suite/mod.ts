import { serve as honoServe } from "@hono/node-server";
import { createNodeWebSocket, type NodeWebSocket } from "@hono/node-ws";
import { bundleRequire } from "bundle-require";
import invariant from "invariant";
import { describe } from "vitest";
import type { Transport } from "@/client/mod";
import { createManagerRouter } from "@/manager/router";
import type { DriverConfig, Registry, RunConfig } from "@/mod";
import { RunConfigSchema } from "@/registry/run-config";
import { getPort } from "@/test/mod";
import { logger } from "./log";
import { runActionFeaturesTests } from "./tests/action-features";
import { runActorConnTests } from "./tests/actor-conn";
import { runActorConnStateTests } from "./tests/actor-conn-state";
import {
	runActorDriverTests,
	runActorDriverTestsWithTransport,
} from "./tests/actor-driver";
import { runActorErrorHandlingTests } from "./tests/actor-error-handling";
import { runActorHandleTests } from "./tests/actor-handle";
import { runActorInlineClientTests } from "./tests/actor-inline-client";
import { runActorInspectorTests } from "./tests/actor-inspector";
import { runActorMetadataTests } from "./tests/actor-metadata";
import { runActorOnStateChangeTests } from "./tests/actor-onstatechange";
import { runActorVarsTests } from "./tests/actor-vars";
import { runManagerDriverTests } from "./tests/manager-driver";
import { runRawHttpTests } from "./tests/raw-http";
import { runRawHttpRequestPropertiesTests } from "./tests/raw-http-request-properties";
import { runRawWebSocketTests } from "./tests/raw-websocket";
import { runRequestAccessTests } from "./tests/request-access";

export interface SkipTests {
	schedule?: boolean;
	sleep?: boolean;
}

export interface DriverTestConfig {
	/** Deploys an registry and returns the connection endpoint. */
	start(projectDir: string): Promise<DriverDeployOutput>;

	/**
	 * If we're testing with an external system, we should use real timers
	 * instead of Vitest's mocked timers.
	 **/
	useRealTimers?: boolean;

	/** Cloudflare Workers has some bugs with cleanup. */
	HACK_skipCleanupNet?: boolean;

	skip?: SkipTests;

	transport?: Transport;

	clientType: ClientType;

	cleanup?: () => Promise<void>;
}

/**
 * The type of client to run the test with.
 *
 * The logic for HTTP vs inline is very different, so this helps validate all behavior matches.
 **/
type ClientType = "http" | "inline";

export interface DriverDeployOutput {
	endpoint: string;
	namespace: string;
	runnerName: string;

	/** Cleans up the test. */
	cleanup(): Promise<void>;
}

/** Runs all Vitest tests against the provided drivers. */
export function runDriverTests(
	driverTestConfigPartial: Omit<DriverTestConfig, "clientType" | "transport">,
) {
	for (const clientType of ["http", "inline"] as ClientType[]) {
		const driverTestConfig: DriverTestConfig = {
			...driverTestConfigPartial,
			clientType,
		};

		describe(`client type (${clientType})`, () => {
			runActorDriverTests(driverTestConfig);
			runManagerDriverTests(driverTestConfig);

			for (const transport of ["websocket", "sse"] as Transport[]) {
				describe(`transport (${transport})`, () => {
					runActorConnTests({
						...driverTestConfig,
						transport,
					});

					runActorConnStateTests({ ...driverTestConfig, transport });

					runRequestAccessTests({ ...driverTestConfig, transport });

					runActorDriverTestsWithTransport({ ...driverTestConfig, transport });
				});
			}

			runActorHandleTests(driverTestConfig);

			runActionFeaturesTests(driverTestConfig);

			runActorVarsTests(driverTestConfig);

			runActorMetadataTests(driverTestConfig);

			runActorOnStateChangeTests(driverTestConfig);

			runActorErrorHandlingTests(driverTestConfig);

			runActorInlineClientTests(driverTestConfig);

			runRawHttpTests(driverTestConfig);

			runRawHttpRequestPropertiesTests(driverTestConfig);

			runRawWebSocketTests(driverTestConfig);

			// TODO: re-expose this once we can have actor queries on the gateway
			// runRawHttpDirectRegistryTests(driverTestConfig);

			// TODO: re-expose this once we can have actor queries on the gateway
			// runRawWebSocketDirectRegistryTests(driverTestConfig);

			runActorInspectorTests(driverTestConfig);
		});
	}
}

/**
 * Helper function to adapt the drivers to the Node.js runtime for tests.
 *
 * This is helpful for drivers that run in-process as opposed to drivers that rely on external tools.
 */
export async function createTestRuntime(
	registryPath: string,
	driverFactory: (registry: Registry<any>) => Promise<{
		rivetEngine?: { endpoint: string; namespace: string; runnerName: string };
		driver: DriverConfig;
		cleanup?: () => Promise<void>;
	}>,
): Promise<DriverDeployOutput> {
	const {
		mod: { registry },
	} = await bundleRequire<{ registry: Registry<any> }>({
		filepath: registryPath,
	});

	// TODO: Find a cleaner way of flagging an registry as test mode (ideally not in the config itself)
	// Force enable test
	registry.config.test.enabled = true;

	// Build drivers
	const {
		driver,
		cleanup: driverCleanup,
		rivetEngine,
	} = await driverFactory(registry);

	if (rivetEngine) {
		// TODO: We don't need createTestRuntime fort his
		// Using external Rivet engine

		const cleanup = async () => {
			await driverCleanup?.();
		};

		return {
			endpoint: rivetEngine.endpoint,
			namespace: rivetEngine.namespace,
			runnerName: rivetEngine.runnerName,
			cleanup,
		};
	} else {
		// Start server for Rivet engine

		// Build driver config
		// biome-ignore lint/style/useConst: Assigned later
		let upgradeWebSocket: any;
		const config: RunConfig = RunConfigSchema.parse({
			driver,
			getUpgradeWebSocket: () => upgradeWebSocket!,
			inspector: {
				enabled: true,
				token: () => "token",
			},
		});

		// Create router
		const managerDriver = driver.manager(registry.config, config);
		const { router } = createManagerRouter(
			registry.config,
			config,
			managerDriver,
			false,
		);

		// Inject WebSocket
		const nodeWebSocket = createNodeWebSocket({ app: router });
		upgradeWebSocket = nodeWebSocket.upgradeWebSocket;

		// Start server
		const port = await getPort();
		const server = honoServe({
			fetch: router.fetch,
			hostname: "127.0.0.1",
			port,
		});
		invariant(
			nodeWebSocket.injectWebSocket !== undefined,
			"should have injectWebSocket",
		);
		nodeWebSocket.injectWebSocket(server);
		const serverEndpoint = `http://127.0.0.1:${port}`;

		logger().info({ msg: "test serer listening", port });

		// Cleanup
		const cleanup = async () => {
			// Stop server
			await new Promise((resolve) => server.close(() => resolve(undefined)));

			// Extra cleanup
			await driverCleanup?.();
		};

		return {
			endpoint: serverEndpoint,
			namespace: "default",
			runnerName: "rivetkit",
			cleanup,
		};
	}
}
