import { UpgradeWebSocket } from "@/utils";
import { Encoding } from "./protocol/serde";
import type { ConnectionHandlers as ConnHandlers } from "./router-endpoints";
import type { Context as HonoContext, HonoRequest } from "hono";

/**
 * Deterines how requests to workers should be routed.
 *
 * Inline handlers calls the connection handlers directly.
 *
 * Custom will let a custom function handle the request. This usually will proxy the request to another location.
 */
export type ConnRoutingHandler =
	| {
			inline: {
				handlers: ConnHandlers;
			};
	  }
	| {
			custom: ConnRoutingHandlerCustom;
	  };

export interface ConnRoutingHandlerCustom {
	sendRequest: SendRequestHandler;
	openWebSocket: OpenWebSocketHandler;
	proxyRequest: ProxyRequestHandler;
	proxyWebSocket: ProxyWebSocketHandler;
}

export type BuildProxyEndpoint = (c: HonoContext, workerId: string) => string;

export type SendRequestHandler = (
	workerId: string,
	meta: unknown | undefined,
	workerRequest: Request,
) => Promise<Response>;

export type OpenWebSocketHandler = (
	workerId: string,
	meta: unknown | undefined,
	encodingKind: Encoding,
) => Promise<WebSocket>;

export type ProxyRequestHandler = (
	c: HonoContext,
	workerRequest: Request,
	workerId: string,
	meta?: unknown,
) => Promise<Response>;

export type ProxyWebSocketHandler = (
	c: HonoContext,
	path: string,
	workerId: string,
	meta?: unknown,
	upgradeWebSocket?: UpgradeWebSocket,
) => Promise<Response>;
