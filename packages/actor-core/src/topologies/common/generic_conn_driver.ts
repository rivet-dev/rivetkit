import type { AnyActor } from "@/actor/runtime/actor";
import { Connection } from "@/actor/runtime/connection";
import { logger } from "./log";
import { CachedSerializer, Encoding } from "@/actor/protocol/serde";
import { ConnectionDriver } from "@/actor/runtime/driver";
import * as messageToClient from "@/actor/protocol/message/to_client";
import { encodeDataToString } from "@/actor/protocol/serde";
import { WSContext } from "hono/ws";
import { SSEStreamingApi } from "hono/streaming";

// This state is different than `PersistedConn` state since the connection-specific state is persisted & must be serializable. This is also part of the connection driver, not part of the core actor.
//
// This holds the actual connections, which are not serializable.
//
// This is scoped to each actor. Do not share between multiple actors.
export class GenericConnGlobalState {
	websockets = new Map<string, WSContext>();
	sseStreams = new Map<string, SSEStreamingApi>();
}

/**
 * Exposes connection drivers for platforms that support vanilla WebSocket, SSE, and HTTP.
 */
export function createGenericConnDrivers(
	globalState: GenericConnGlobalState,
): Record<string, ConnectionDriver> {
	return {
		[CONN_DRIVER_GENERIC_WEBSOCKET]: createGenericWebSocketDriver(globalState),
		[CONN_DRIVER_GENERIC_SSE]: createGenericSseDriver(globalState),
		[CONN_DRIVER_GENERIC_HTTP]: createGeneircHttpDriver(),
	};
}

// MARK: WebSocket
export const CONN_DRIVER_GENERIC_WEBSOCKET = "genericWebSocket";

export interface GenericWebSocketDriverState {
	encoding: Encoding;
}

export function createGenericWebSocketDriver(
	globalState: GenericConnGlobalState,
): ConnectionDriver<GenericWebSocketDriverState> {
	return {
		sendMessage: (
			_actor: AnyActor,
			conn: Connection<AnyActor>,
			state: GenericWebSocketDriverState,
			message: CachedSerializer<messageToClient.ToClient>,
		) => {
			const ws = globalState.websockets.get(conn.id);
			if (!ws) {
				logger().warn("missing ws for sendMessage", { connId: conn.id });
				return;
			}
			ws.send(message.serialize(state.encoding));
		},

		disconnect: async (
			_actor: AnyActor,
			conn: Connection<AnyActor>,
			_state: GenericWebSocketDriverState,
			reason?: string,
		) => {
			const ws = globalState.websockets.get(conn.id);
			if (!ws) {
				logger().warn("missing ws for disconnect", { connId: conn.id });
				return;
			}

			const raw = ws.raw as WebSocket;
			if (!raw) {
				logger().warn("ws.raw does not exist");
				return;
			}

			// Create promise to wait for socket to close gracefully
			const { promise, resolve } = Promise.withResolvers<void>();
			raw.addEventListener("close", () => resolve());

			// Close socket
			ws.close(1000, reason);

			await promise;
		},
	};
}

// MARK: SSE
export const CONN_DRIVER_GENERIC_SSE = "genericSse";

export interface GenericSseDriverState {
	encoding: Encoding;
}

export function createGenericSseDriver(globalState: GenericConnGlobalState) {
	return {
		sendMessage: (
			_actor: AnyActor,
			conn: Connection<AnyActor>,
			state: GenericSseDriverState,
			message: CachedSerializer<messageToClient.ToClient>,
		) => {
			const stream = globalState.sseStreams.get(conn.id);
			if (!stream) {
				logger().warn("missing sse stream for sendMessage", {
					connId: conn.id,
				});
				return;
			}
			stream.writeSSE({
				data: encodeDataToString(message.serialize(state.encoding)),
			});
		},

		disconnect: async (
			_actor: AnyActor,
			conn: Connection<AnyActor>,
			_state: GenericSseDriverState,
			_reason?: string,
		) => {
			const stream = globalState.sseStreams.get(conn.id);
			if (!stream) {
				logger().warn("missing sse stream for disconnect", { connId: conn.id });
				return;
			}

			stream.close();
		},
	};
}

// MARK: HTTP
export const CONN_DRIVER_GENERIC_HTTP = "genericHttp";

export type GenericHttpDriverState = Record<never, never>;

export function createGeneircHttpDriver() {
	return {
		sendMessage: () => {
			logger().warn("attempting to send message to http connection");
		},

		disconnect: async () => {
			// Noop
		},
	};
}
