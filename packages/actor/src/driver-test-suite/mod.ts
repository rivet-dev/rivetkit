import { serve as honoServe } from "@hono/node-server";
import {
	ActorDriver,
	CoordinateDriver,
	DriverConfig,
	ManagerDriver,
} from "@/driver-helpers/mod";
import { runActorDriverTests } from "./tests/actor-driver";
import { runManagerDriverTests } from "./tests/manager-driver";
import { describe } from "vitest";
import {
	type ActorCoreApp,
	CoordinateTopology,
	StandaloneTopology,
} from "@/mod";
import { createNodeWebSocket, type NodeWebSocket } from "@hono/node-ws";
import invariant from "invariant";
import { bundleRequire } from "bundle-require";
import { getPort } from "@/test/mod";
import { Client, Transport } from "@/client/mod";
import { runActorConnTests } from "./tests/actor-conn";
import { runActorHandleTests } from "./tests/actor-handle";
import { runActionFeaturesTests } from "./tests/action-features";
import { runActorVarsTests } from "./tests/actor-vars";
import { runActorConnStateTests } from "./tests/actor-conn-state";
import { runActorMetadataTests } from "./tests/actor-metadata";
import { runActorErrorHandlingTests } from "./tests/actor-error-handling";
import { ClientDriver } from "@/client/client";

export interface DriverTestConfig {
	/** Deploys an app and returns the connection endpoint. */
	start(appPath: string): Promise<DriverDeployOutput>;

	/**
	 * If we're testing with an external system, we should use real timers
	 * instead of Vitest's mocked timers.
	 **/
	useRealTimers?: boolean;

	/** Cloudflare Workers has some bugs with cleanup. */
	HACK_skipCleanupNet?: boolean;

	transport?: Transport;

	clientType: ClientType;
}

/**
 * The type of client to run the test with.
 *
 * The logic for HTTP vs inline is very different, so this helps validate all behavior matches.
 **/
type ClientType = "http" | "inline";

export interface DriverDeployOutput {
	endpoint: string;
	inlineClientDriver: ClientDriver;

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
				});
			}

			runActorHandleTests(driverTestConfig);

			runActionFeaturesTests(driverTestConfig);

			runActorVarsTests(driverTestConfig);

			runActorMetadataTests(driverTestConfig);

			runActorErrorHandlingTests(driverTestConfig);
		});
	}
}

/**
 * Helper function to adapt the drivers to the Node.js runtime for tests.
 *
 * This is helpful for drivers that run in-process as opposed to drivers that rely on external tools.
 */
export async function createTestRuntime(
	appPath: string,
	driverFactory: (app: ActorCoreApp<any>) => Promise<{
		actorDriver: ActorDriver;
		managerDriver: ManagerDriver;
		coordinateDriver?: CoordinateDriver;
		cleanup?: () => Promise<void>;
	}>,
): Promise<DriverDeployOutput> {
	const {
		mod: { app },
	} = await bundleRequire({
		filepath: appPath,
	});

	// Build drivers
	const {
		actorDriver,
		managerDriver,
		coordinateDriver,
		cleanup: driverCleanup,
	} = await driverFactory(app);

	// Build driver config
	let injectWebSocket: NodeWebSocket["injectWebSocket"] | undefined;
	const config: DriverConfig = {
		drivers: {
			actor: actorDriver,
			manager: managerDriver,
			coordinate: coordinateDriver,
		},
		getUpgradeWebSocket: (app) => {
			const webSocket = createNodeWebSocket({ app });
			injectWebSocket = webSocket.injectWebSocket;
			return webSocket.upgradeWebSocket;
		},
	};

	// Build topology
	const topology = coordinateDriver
		? new CoordinateTopology(app.config, config)
		: new StandaloneTopology(app.config, config);
	if (!injectWebSocket) throw new Error("injectWebSocket not defined");

	// Start server
	const port = await getPort();
	const server = honoServe({
		fetch: topology.router.fetch,
		hostname: "127.0.0.1",
		port,
	});
	invariant(injectWebSocket !== undefined, "should have injectWebSocket");
	injectWebSocket(server);

	// Cleanup
	const cleanup = async () => {
		// Stop server
		await new Promise((resolve) => server.close(() => resolve(undefined)));

		// Extra cleanup
		await driverCleanup?.();
	};

	return {
		endpoint: `http://127.0.0.1:${port}`,
		inlineClientDriver: topology.clientDriver,
		cleanup,
	};
}
