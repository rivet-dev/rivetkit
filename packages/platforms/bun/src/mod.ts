import type { Serve, Server, ServerWebSocket, WebSocketHandler } from "bun";
import { assertUnreachable } from "actor-core/utils";
import { CoordinateTopology } from "actor-core/topologies/coordinate";
import type { Config } from "./config";
import { logger } from "./log";
import { createBunWebSocket } from "hono/bun";
import type { Hono } from "hono";
import { StandaloneTopology } from "actor-core";
import { MemoryManagerDriver } from "@actor-core/memory/manager";
import { MemoryActorDriver } from "@actor-core/memory/actor";

export function createRouter(config: Config): {
	router: Hono;
	webSocketHandler: WebSocketHandler;
} {
	// Setup WebSocket routing for Bun
	const webSocket = createBunWebSocket<ServerWebSocket>();
	if (!config.getUpgradeWebSocket) {
		config.getUpgradeWebSocket = () => webSocket.upgradeWebSocket;
	}

	// HACK: Hono BunWebSocketHandler type is not compatible with Bun's
	const webSocketHandler = webSocket.websocket as unknown as WebSocketHandler;

	// Configure default configuration
	if (!config.topology) config.topology = "standalone";
	if (!config.drivers) config.drivers = {};
	if (!config.drivers.manager)
		config.drivers.manager = new MemoryManagerDriver();
	if (!config.drivers.actor) config.drivers.actor = new MemoryActorDriver();

	// Setup topology
	if (config.topology === "standalone") {
		const topology = new StandaloneTopology(config);
		return { router: topology.router, webSocketHandler };
	} else if (config.topology === "partition") {
		throw new Error("Bun only supports standalone & coordinate topology.");
	} else if (config.topology === "coordinate") {
		const topology = new CoordinateTopology(config);
		return { router: topology.router, webSocketHandler };
	} else {
		assertUnreachable(config.topology);
	}
}

export function createHandler(config: Config): Serve {
	const { router, webSocketHandler } = createRouter(config);

	return {
		hostname: config.server?.hostname ?? process.env.HOSTNAME,
		port: config.server?.port ?? Number.parseInt(process.env.PORT ?? "8787"),
		fetch: router.fetch,
		websocket: webSocketHandler,
	};
}

export function serve(config: Config): Server {
	const handler = createHandler(config);
	const server = Bun.serve(handler);

	const hostname = config.server?.hostname ?? process.env.HOSTNAME;
	const port =
		config.server?.port ?? Number.parseInt(process.env.PORT ?? "8787");

	logger().info("actorcore started", { hostname, port });

	return server;
}
