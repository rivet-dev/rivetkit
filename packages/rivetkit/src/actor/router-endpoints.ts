import * as cbor from "cbor-x";
import type { Context as HonoContext, HonoRequest } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import type { WSContext } from "hono/ws";
import { ActionContext } from "@/actor/action";
import type { AnyConn } from "@/actor/connection";
import {
	CONNECTION_DRIVER_HTTP,
	CONNECTION_DRIVER_SSE,
	CONNECTION_DRIVER_WEBSOCKET,
	generateConnId,
	generateConnToken,
} from "@/actor/connection";
import * as errors from "@/actor/errors";
import type { AnyActorInstance } from "@/actor/instance";
import type { InputData } from "@/actor/protocol/serde";
import { type Encoding, EncodingSchema } from "@/actor/protocol/serde";
import type { UpgradeWebSocketArgs } from "@/common/inline-websocket-adapter2";
import { deconstructError, stringifyError } from "@/common/utils";
import type { UniversalWebSocket } from "@/common/websocket-interface";
import { HonoWebSocketAdapter } from "@/manager/hono-websocket-adapter";
import type { RunConfig } from "@/registry/run-config";
import type * as protocol from "@/schemas/client-protocol/mod";
import {
	HTTP_ACTION_REQUEST_VERSIONED,
	HTTP_ACTION_RESPONSE_VERSIONED,
	TO_SERVER_VERSIONED,
} from "@/schemas/client-protocol/versioned";
import {
	contentTypeForEncoding,
	deserializeWithEncoding,
	serializeWithEncoding,
} from "@/serde";
import { bufferToArrayBuffer } from "@/utils";
import type { ActorDriver } from "./driver";
import type {
	GenericHttpDriverState,
	GenericSseDriverState,
	GenericWebSocketDriverState,
} from "./generic-conn-driver";
import { loggerWithoutContext } from "./log";
import { parseMessage } from "./protocol/old";

export interface ConnectWebSocketOpts {
	req?: HonoRequest;
	encoding: Encoding;
	actorId: string;
	params: unknown;
	authData: unknown;
}

export interface ConnectWebSocketOutput {
	onOpen: (ws: WSContext) => void;
	onMessage: (message: protocol.ToServer) => void;
	onClose: () => void;
}

export interface ConnectSseOpts {
	req?: HonoRequest;
	encoding: Encoding;
	params: unknown;
	actorId: string;
	authData: unknown;
}

export interface ConnectSseOutput {
	onOpen: (stream: SSEStreamingApi) => void;
	onClose: () => Promise<void>;
}

export interface ActionOpts {
	req?: HonoRequest;
	params: unknown;
	actionName: string;
	actionArgs: unknown[];
	actorId: string;
	authData: unknown;
}

export interface ActionOutput {
	output: unknown;
}

export interface ConnsMessageOpts {
	req?: HonoRequest;
	connId: string;
	connToken: string;
	message: protocol.ToServer;
	actorId: string;
}

export interface FetchOpts {
	request: Request;
	actorId: string;
	authData: unknown;
}

export interface WebSocketOpts {
	request: Request;
	websocket: UniversalWebSocket;
	actorId: string;
	authData: unknown;
}

/**
 * Creates a WebSocket connection handler
 */
export async function handleWebSocketConnect(
	req: Request | undefined,
	runConfig: RunConfig,
	actorDriver: ActorDriver,
	actorId: string,
	encoding: Encoding,
	parameters: unknown,
	authData: unknown,
	subscriptions: string[],
): Promise<UpgradeWebSocketArgs> {
	const exposeInternalError = req ? getRequestExposeInternalError(req) : false;

	// Setup promise for the init handlers since all other behavior depends on this
	const {
		promise: handlersPromise,
		resolve: handlersResolve,
		reject: handlersReject,
	} = Promise.withResolvers<{
		conn: AnyConn;
		actor: AnyActorInstance;
		connId: string;
	}>();

	// Pre-load the actor to catch errors early
	let actor: AnyActorInstance;
	try {
		actor = await actorDriver.loadActor(actorId);
	} catch (error) {
		// Return handler that immediately closes with error
		return {
			onOpen: (_evt: any, ws: WSContext) => {
				const { code } = deconstructError(
					error,
					actor.rLog,
					{
						wsEvent: "open",
					},
					exposeInternalError,
				);
				ws.close(1011, code);
			},
			onMessage: (_evt: { data: any }, ws: WSContext) => {
				ws.close(1011, "Actor not loaded");
			},
			onClose: (_event: any, _ws: WSContext) => {},
			onError: (_error: unknown) => {},
		};
	}

	return {
		onOpen: (_evt: any, ws: WSContext) => {
			actor.rLog.debug("websocket open");

			// Run async operations in background
			(async () => {
				try {
					const connId = generateConnId();
					const connToken = generateConnToken();
					const connState = await actor.prepareConn(parameters, req);

					// Save socket
					const connGlobalState =
						actorDriver.getGenericConnGlobalState(actorId);
					connGlobalState.websockets.set(connId, ws);
					actor.rLog.debug({
						msg: "registered websocket for conn",
						actorId,
						totalCount: connGlobalState.websockets.size,
					});

					// Create connection
					const conn = await actor.createConn(
						connId,
						connToken,
						parameters,
						connState,
						CONNECTION_DRIVER_WEBSOCKET,
						{ encoding } satisfies GenericWebSocketDriverState,
						subscriptions,
						authData,
					);

					// Unblock other handlers
					handlersResolve({ conn, actor, connId });
				} catch (error) {
					handlersReject(error);

					const { code } = deconstructError(
						error,
						actor.rLog,
						{
							wsEvent: "open",
						},
						exposeInternalError,
					);
					ws.close(1011, code);
				}
			})();
		},
		onMessage: (evt: { data: any }, ws: WSContext) => {
			// Handle message asynchronously
			handlersPromise
				.then(({ conn, actor }) => {
					actor.rLog.debug({ msg: "received message" });

					const value = evt.data.valueOf() as InputData;
					parseMessage(value, {
						encoding: encoding,
						maxIncomingMessageSize: runConfig.maxIncomingMessageSize,
					})
						.then((message) => {
							actor.processMessage(message, conn).catch((error) => {
								const { code } = deconstructError(
									error,
									actor.rLog,
									{
										wsEvent: "message",
									},
									exposeInternalError,
								);
								ws.close(1011, code);
							});
						})
						.catch((error) => {
							const { code } = deconstructError(
								error,
								actor.rLog,
								{
									wsEvent: "message",
								},
								exposeInternalError,
							);
							ws.close(1011, code);
						});
				})
				.catch((error) => {
					const { code } = deconstructError(
						error,
						actor.rLog,
						{
							wsEvent: "message",
						},
						exposeInternalError,
					);
					ws.close(1011, code);
				});
		},
		onClose: (
			event: {
				wasClean: boolean;
				code: number;
				reason: string;
			},
			ws: WSContext,
		) => {
			if (event.wasClean) {
				actor.rLog.info({
					msg: "websocket closed",
					code: event.code,
					reason: event.reason,
					wasClean: event.wasClean,
				});
			} else {
				actor.rLog.warn({
					msg: "websocket closed",
					code: event.code,
					reason: event.reason,
					wasClean: event.wasClean,
				});
			}

			// HACK: Close socket in order to fix bug with Cloudflare leaving WS in closing state
			// https://github.com/cloudflare/workerd/issues/2569
			ws.close(1000, "hack_force_close");

			// Handle cleanup asynchronously
			handlersPromise
				.then(({ conn, actor, connId }) => {
					const connGlobalState =
						actorDriver.getGenericConnGlobalState(actorId);
					const didDelete = connGlobalState.websockets.delete(connId);
					if (didDelete) {
						actor.rLog.info({
							msg: "removing websocket for conn",
							totalCount: connGlobalState.websockets.size,
						});
					} else {
						actor.rLog.warn({
							msg: "websocket does not exist for conn",
							actorId,
							totalCount: connGlobalState.websockets.size,
						});
					}

					actor.__removeConn(conn);
				})
				.catch((error) => {
					deconstructError(
						error,
						actor.rLog,
						{ wsEvent: "close" },
						exposeInternalError,
					);
				});
		},
		onError: (_error: unknown) => {
			try {
				// Actors don't need to know about this, since it's abstracted away
				actor.rLog.warn({ msg: "websocket error" });
			} catch (error) {
				deconstructError(
					error,
					actor.rLog,
					{ wsEvent: "error" },
					exposeInternalError,
				);
			}
		},
	};
}

/**
 * Creates an SSE connection handler
 */
export async function handleSseConnect(
	c: HonoContext,
	_runConfig: RunConfig,
	actorDriver: ActorDriver,
	actorId: string,
	subscriptions: string[],
	authData: unknown,
) {
	const encoding = getRequestEncoding(c.req);
	const parameters = getRequestConnParams(c.req);

	// Return the main handler with all async work inside
	return streamSSE(c, async (stream) => {
		let actor: AnyActorInstance | undefined;
		let connId: string | undefined;
		let connToken: string | undefined;
		let connState: unknown;
		let conn: AnyConn | undefined;

		try {
			// Do all async work inside the handler
			actor = await actorDriver.loadActor(actorId);
			connId = generateConnId();
			connToken = generateConnToken();
			connState = await actor.prepareConn(parameters, c.req.raw);

			actor.rLog.debug("sse open");

			// Save stream
			actorDriver
				.getGenericConnGlobalState(actorId)
				.sseStreams.set(connId, stream);

			// Create connection
			conn = await actor.createConn(
				connId,
				connToken,
				parameters,
				connState,
				CONNECTION_DRIVER_SSE,
				{ encoding } satisfies GenericSseDriverState,
				subscriptions,
				authData,
			);

			// Wait for close
			const abortResolver = Promise.withResolvers();

			// Handle stream abort (when client closes the connection)
			stream.onAbort(async () => {
				const rLog = actor?.rLog ?? loggerWithoutContext();
				try {
					rLog.debug("sse stream aborted");

					// Cleanup
					if (connId) {
						actorDriver
							.getGenericConnGlobalState(actorId)
							.sseStreams.delete(connId);
					}
					if (conn && actor) {
						actor.__removeConn(conn);
					}

					abortResolver.resolve(undefined);
				} catch (error) {
					rLog.error({ msg: "error closing sse connection", error });
					abortResolver.resolve(undefined);
				}
			});

			// HACK: Will throw if not configured
			try {
				c.executionCtx.waitUntil(abortResolver.promise);
			} catch {}

			// Wait until connection aborted
			await abortResolver.promise;
		} catch (error) {
			loggerWithoutContext().error({ msg: "error in sse connection", error });

			// Cleanup on error
			if (connId !== undefined) {
				actorDriver
					.getGenericConnGlobalState(actorId)
					.sseStreams.delete(connId);
			}
			if (conn && actor !== undefined) {
				actor.__removeConn(conn);
			}

			// Close the stream on error
			stream.close();
		}
	});
}

/**
 * Creates an action handler
 */
export async function handleAction(
	c: HonoContext,
	_runConfig: RunConfig,
	actorDriver: ActorDriver,
	actionName: string,
	actorId: string,
	authData: unknown,
) {
	const encoding = getRequestEncoding(c.req);
	const parameters = getRequestConnParams(c.req);

	// Validate incoming request
	const arrayBuffer = await c.req.arrayBuffer();
	const request = deserializeWithEncoding(
		encoding,
		new Uint8Array(arrayBuffer),
		HTTP_ACTION_REQUEST_VERSIONED,
	);
	const actionArgs = cbor.decode(new Uint8Array(request.args));

	// Invoke the action
	let actor: AnyActorInstance | undefined;
	let conn: AnyConn | undefined;
	let output: unknown | undefined;
	try {
		actor = await actorDriver.loadActor(actorId);

		actor.rLog.debug({ msg: "handling action", actionName, encoding });

		// Create conn
		const connState = await actor.prepareConn(parameters, c.req.raw);
		conn = await actor.createConn(
			generateConnId(),
			generateConnToken(),
			parameters,
			connState,
			CONNECTION_DRIVER_HTTP,
			{} satisfies GenericHttpDriverState,
			[],
			authData,
		);

		// Call action
		const ctx = new ActionContext(actor.actorContext!, conn!);
		output = await actor.executeAction(ctx, actionName, actionArgs);
	} finally {
		if (conn) {
			actor?.__removeConn(conn);
		}
	}

	// Send response
	const responseData: protocol.HttpActionResponse = {
		output: bufferToArrayBuffer(cbor.encode(output)),
	};
	const serialized = serializeWithEncoding(
		encoding,
		responseData,
		HTTP_ACTION_RESPONSE_VERSIONED,
	);
	return c.body(serialized as Uint8Array, 200, {
		"Content-Type": contentTypeForEncoding(encoding),
	});
}

/**
 * Create a connection message handler
 */
export async function handleConnectionMessage(
	c: HonoContext,
	_runConfig: RunConfig,
	actorDriver: ActorDriver,
	connId: string,
	connToken: string,
	actorId: string,
) {
	const encoding = getRequestEncoding(c.req);

	// Validate incoming request
	const arrayBuffer = await c.req.arrayBuffer();
	const message = deserializeWithEncoding(
		encoding,
		new Uint8Array(arrayBuffer),
		TO_SERVER_VERSIONED,
	);

	const actor = await actorDriver.loadActor(actorId);

	// Find connection
	const conn = actor.conns.get(connId);
	if (!conn) {
		throw new errors.ConnNotFound(connId);
	}

	// Authenticate connection
	if (conn._token !== connToken) {
		throw new errors.IncorrectConnToken();
	}

	// Process message
	await actor.processMessage(message, conn);

	return c.json({});
}

export async function handleRawWebSocketHandler(
	req: Request | undefined,
	path: string,
	actorDriver: ActorDriver,
	actorId: string,
	authData: unknown,
): Promise<UpgradeWebSocketArgs> {
	const actor = await actorDriver.loadActor(actorId);

	// Return WebSocket event handlers
	return {
		onOpen: (_evt: any, ws: any) => {
			// Wrap the Hono WebSocket in our adapter
			const adapter = new HonoWebSocketAdapter(ws);

			// Store adapter reference on the WebSocket for event handlers
			(ws as any).__adapter = adapter;

			// Extract the path after prefix and preserve query parameters
			// Use URL API for cleaner parsing
			const url = new URL(path, "http://actor");
			const pathname = url.pathname.replace(/^\/raw\/websocket\/?/, "") || "/";
			const normalizedPath =
				(pathname.startsWith("/") ? pathname : "/" + pathname) + url.search;

			let newRequest: Request;
			if (req) {
				newRequest = new Request(`http://actor${normalizedPath}`, req);
			} else {
				newRequest = new Request(`http://actor${normalizedPath}`, {
					method: "GET",
				});
			}

			actor.rLog.debug({
				msg: "rewriting websocket url",
				from: path,
				to: newRequest.url,
				pathname: url.pathname,
				search: url.search,
				normalizedPath,
			});

			// Call the actor's onWebSocket handler with the adapted WebSocket
			actor.handleWebSocket(adapter, {
				request: newRequest,
			});
		},
		onMessage: (event: any, ws: any) => {
			// Find the adapter for this WebSocket
			const adapter = (ws as any).__adapter;
			if (adapter) {
				adapter._handleMessage(event);
			}
		},
		onClose: (evt: any, ws: any) => {
			// Find the adapter for this WebSocket
			const adapter = (ws as any).__adapter;
			if (adapter) {
				adapter._handleClose(evt?.code || 1006, evt?.reason || "");
			}
		},
		onError: (error: any, ws: any) => {
			// Find the adapter for this WebSocket
			const adapter = (ws as any).__adapter;
			if (adapter) {
				adapter._handleError(error);
			}
		},
	};
}

// Helper to get the connection encoding from a request
export function getRequestEncoding(req: HonoRequest): Encoding {
	const encodingParam = req.header(HEADER_ENCODING);
	if (!encodingParam) {
		throw new errors.InvalidEncoding("undefined");
	}

	const result = EncodingSchema.safeParse(encodingParam);
	if (!result.success) {
		throw new errors.InvalidEncoding(encodingParam as string);
	}

	return result.data;
}

export function getRequestExposeInternalError(_req: Request): boolean {
	// Unipmlemented
	return false;
}

export function getRequestQuery(c: HonoContext): unknown {
	// Get query parameters for actor lookup
	const queryParam = c.req.header(HEADER_ACTOR_QUERY);
	if (!queryParam) {
		loggerWithoutContext().error({ msg: "missing query parameter" });
		throw new errors.InvalidRequest("missing query");
	}

	// Parse the query JSON and validate with schema
	try {
		const parsed = JSON.parse(queryParam);
		return parsed;
	} catch (error) {
		loggerWithoutContext().error({ msg: "invalid query json", error });
		throw new errors.InvalidQueryJSON(error);
	}
}

export const HEADER_ACTOR_QUERY = "X-RivetKit-Query";

export const HEADER_ENCODING = "X-RivetKit-Encoding";

// IMPORTANT: Params must be in headers or in an E2EE part of the request (i.e. NOT the URL or query string) in order to ensure that tokens can be securely passed in params.
export const HEADER_CONN_PARAMS = "X-RivetKit-Conn-Params";

// Internal header
export const HEADER_AUTH_DATA = "X-RivetKit-Auth-Data";

export const HEADER_ACTOR_ID = "X-RivetKit-Actor";

export const HEADER_CONN_ID = "X-RivetKit-Conn";

export const HEADER_CONN_TOKEN = "X-RivetKit-Conn-Token";

export const HEADER_CONN_SUBS = "X-RivetKit-Conn-Subs";

/**
 * Headers that publics can send from public clients.
 *
 * Used for CORS.
 **/
export const ALLOWED_PUBLIC_HEADERS = [
	"Content-Type",
	"User-Agent",
	HEADER_ACTOR_QUERY,
	HEADER_ENCODING,
	HEADER_CONN_PARAMS,
	HEADER_ACTOR_ID,
	HEADER_CONN_ID,
	HEADER_CONN_TOKEN,
	HEADER_CONN_SUBS,
];

// Helper to get connection parameters for the request
export function getRequestConnParams(req: HonoRequest): unknown {
	const paramsParam = req.header(HEADER_CONN_PARAMS);
	if (!paramsParam) {
		return null;
	}

	try {
		return JSON.parse(paramsParam);
	} catch (err) {
		throw new errors.InvalidParams(
			`Invalid params JSON: ${stringifyError(err)}`,
		);
	}
}
