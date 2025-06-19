import { Hono, type Context as HonoContext } from "hono";
import { logger } from "./log";
import { cors } from "hono/cors";
import {
	handleRouteError,
	handleRouteNotFound,
	loggerMiddleware,
} from "@/common/router";
import type { DriverConfig } from "@/driver-helpers/config";
import type { RegistryConfig } from "@/registry/config";
import {
	type WorkerInspectorConnHandler,
	createWorkerInspectorRouter,
} from "@/inspector/worker";
import {
	type ConnectWebSocketOpts,
	type ConnectWebSocketOutput,
	type ConnectSseOpts,
	type ConnectSseOutput,
	type ActionOpts,
	type ActionOutput,
	type ConnsMessageOpts,
	type ConnectionHandlers,
	handleWebSocketConnect,
	handleSseConnect,
	handleAction,
	handleConnectionMessage,
	HEADER_CONN_TOKEN,
	HEADER_CONN_ID,
	ALL_PUBLIC_HEADERS,
	HEADER_CONN_PARAMS,
	HEADER_AUTH_DATA,
	HEADER_ENCODING,
} from "@/worker/router-endpoints";
import invariant from "invariant";
import { EncodingSchema } from "@/worker/protocol/serde";

export type {
	ConnectWebSocketOpts,
	ConnectWebSocketOutput,
	ConnectSseOpts,
	ConnectSseOutput,
	ActionOpts,
	ActionOutput,
	ConnsMessageOpts,
};

export interface WorkerRouterHandler {
	getWorkerId: () => Promise<string>;

	// Connection handlers as a required subobject
	connectionHandlers: ConnectionHandlers;

	onConnectInspector?: WorkerInspectorConnHandler;
}

/**
 * Creates a router that runs on the partitioned instance.
 */
export function createWorkerRouter(
	registryConfig: RegistryConfig,
	driverConfig: DriverConfig,
	handler: WorkerRouterHandler,
): Hono {
	const router = new Hono();

	const upgradeWebSocket = driverConfig.getUpgradeWebSocket?.(router);

	router.use("*", loggerMiddleware(logger()));

	// Apply CORS middleware if configured
	//
	//This is only relevant if the worker is exposed directly publicly
	if (registryConfig.cors) {
		const corsConfig = registryConfig.cors;

		router.use("*", async (c, next) => {
			const path = c.req.path;

			// Don't apply to WebSocket routes, see https://hono.dev/docs/helpers/websocket#upgradewebsocket
			if (path === "/connect/websocket" || path === "/inspect") {
				return next();
			}

			return cors({
				...corsConfig,
				allowHeaders: [
					...(registryConfig.cors?.allowHeaders ?? []),
					...ALL_PUBLIC_HEADERS,
				],
			})(c, next);
		});
	}

	router.get("/", (c) => {
		return c.text(
			"This is an RivetKit server.\n\nLearn more at https://rivetkit.org",
		);
	});

	router.get("/health", (c) => {
		return c.text("ok");
	});

	// Use the handlers from connectionHandlers
	const handlers = handler.connectionHandlers;

	if (upgradeWebSocket) {
		router.get(
			"/connect/websocket",
			upgradeWebSocket(async (c) => {
				const workerId = await handler.getWorkerId();
				const encodingRaw = c.req.header(HEADER_ENCODING);
				const connParamsRaw = c.req.header(HEADER_CONN_PARAMS);
				const authDataRaw = c.req.header(HEADER_AUTH_DATA);

				const encoding = EncodingSchema.parse(encodingRaw);
				const connParams = connParamsRaw
					? JSON.parse(connParamsRaw)
					: undefined;
				const authData = authDataRaw ? JSON.parse(authDataRaw) : undefined;

				return handleWebSocketConnect(
					c as HonoContext,
					registryConfig,
					handlers.onConnectWebSocket!,
					workerId,
					encoding,
					connParams,
					authData,
				);
			}),
		);
	} else {
		router.get("/connect/websocket", (c) => {
			return c.text(
				"WebSockets are not enabled for this driver. Use SSE instead.",
				400,
			);
		});
	}

	router.get("/connect/sse", async (c) => {
		if (!handlers.onConnectSse) {
			throw new Error("onConnectSse handler is required");
		}
		const workerId = await handler.getWorkerId();

		const authDataRaw = c.req.header(HEADER_AUTH_DATA);
		let authData: unknown = undefined;
		if (authDataRaw) {
			authData = JSON.parse(authDataRaw);
		}

		return handleSseConnect(
			c,
			registryConfig,
			driverConfig,
			handlers.onConnectSse,
			workerId,
			authData,
		);
	});

	router.post("/action/:action", async (c) => {
		if (!handlers.onAction) {
			throw new Error("onAction handler is required");
		}
		const actionName = c.req.param("action");
		const workerId = await handler.getWorkerId();

		const authDataRaw = c.req.header(HEADER_AUTH_DATA);
		let authData: unknown = undefined;
		if (authDataRaw) {
			authData = JSON.parse(authDataRaw);
		}

		return handleAction(
			c,
			registryConfig,
			driverConfig,
			handlers.onAction,
			actionName,
			workerId,
			authData,
		);
	});

	router.post("/connections/message", async (c) => {
		if (!handlers.onConnMessage) {
			throw new Error("onConnMessage handler is required");
		}
		const connId = c.req.header(HEADER_CONN_ID);
		const connToken = c.req.header(HEADER_CONN_TOKEN);
		const workerId = await handler.getWorkerId();
		if (!connId || !connToken) {
			throw new Error("Missing required parameters");
		}
		return handleConnectionMessage(
			c,
			registryConfig,
			handlers.onConnMessage,
			connId,
			connToken,
			workerId,
		);
	});

	if (registryConfig.inspector.enabled) {
		router.route(
			"/inspect",
			createWorkerInspectorRouter(
				upgradeWebSocket,
				handler.onConnectInspector,
				registryConfig.inspector,
			),
		);
	}

	router.notFound(handleRouteNotFound);
	router.onError(
		handleRouteError.bind(undefined, {
			// All headers to this endpoint are considered secure, so we can enable the expose internal error header for requests from the internal client
			enableExposeInternalError: true,
		}),
	);

	return router;
}
