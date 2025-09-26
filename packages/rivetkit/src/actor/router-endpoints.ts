import * as cbor from "cbor-x";
import type { Context as HonoContext, HonoRequest } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import type { WSContext } from "hono/ws";
import invariant from "invariant";
import { ActionContext } from "@/actor/action";
import type { AnyConn } from "@/actor/conn";
import { generateConnId, generateConnToken } from "@/actor/conn";
import * as errors from "@/actor/errors";
import type { AnyActorInstance } from "@/actor/instance";
import type { InputData } from "@/actor/protocol/serde";
import { type Encoding, EncodingSchema } from "@/actor/protocol/serde";
import {
	HEADER_ACTOR_QUERY,
	HEADER_CONN_PARAMS,
	HEADER_ENCODING,
} from "@/common/actor-router-consts";
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
import { bufferToArrayBuffer, promiseWithResolvers } from "@/utils";
import { ConnDriverKind } from "./conn-drivers";
import type { ActorDriver } from "./driver";
import { loggerWithoutContext } from "./log";
import { parseMessage } from "./protocol/old";

export const SSE_PING_INTERVAL = 1000;

export interface ConnectWebSocketOpts {
	req?: HonoRequest;
	encoding: Encoding;
	actorId: string;
	params: unknown;
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
}

export interface WebSocketOpts {
	request: Request;
	websocket: UniversalWebSocket;
	actorId: string;
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
): Promise<UpgradeWebSocketArgs> {
	const exposeInternalError = req ? getRequestExposeInternalError(req) : false;

	// Setup promise for the init handlers since all other behavior depends on this
	const {
		promise: handlersPromise,
		resolve: handlersResolve,
		reject: handlersReject,
	} = promiseWithResolvers<{
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

	// Promise used to wait for the websocket close in `disconnect`
	const closePromise = promiseWithResolvers<void>();

	return {
		onOpen: (_evt: any, ws: WSContext) => {
			actor.rLog.debug("actor websocket open");

			// Run async operations in background
			(async () => {
				try {
					const connId = generateConnId();
					const connToken = generateConnToken();
					const connState = await actor.prepareConn(parameters, req);

					// Save socket
					actor.rLog.debug({
						msg: "registered websocket for conn",
						actorId,
					});

					// Create connection
					const conn = await actor.createConn(
						connId,
						connToken,
						parameters,
						connState,
						{
							[ConnDriverKind.WEBSOCKET]: {
								encoding,
								websocket: ws,
								closePromise,
							},
						},
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
			handlersReject(`WebSocket closed (${event.code}): ${event.reason}`);

			closePromise.resolve();

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
				.then(({ conn, actor }) => {
					actor.__connDisconnected(conn, event.wasClean);
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
) {
	c.header("Content-Encoding", "Identity");

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

			// Create connection
			conn = await actor.createConn(connId, connToken, parameters, connState, {
				[ConnDriverKind.SSE]: {
					encoding,
					stream: stream,
				},
			});

			// Wait for close
			const abortResolver = promiseWithResolvers();

			// HACK: This is required so the abort handler below works
			//
			// See https://github.com/honojs/hono/issues/1770#issuecomment-2461966225
			stream.onAbort(() => {});

			// Handle stream abort (when client closes the connection)
			c.req.raw.signal.addEventListener("abort", async () => {
				invariant(actor, "actor should exist");
				const rLog = actor.rLog ?? loggerWithoutContext();
				try {
					rLog.debug("sse stream aborted");

					// Cleanup
					if (conn) {
						actor.__connDisconnected(conn, false);
					}

					abortResolver.resolve(undefined);
				} catch (error) {
					rLog.error({ msg: "error closing sse connection", error });
					abortResolver.resolve(undefined);
				}
			});

			// // HACK: Will throw if not configured
			// try {
			// 	c.executionCtx.waitUntil(abortResolver.promise);
			// } catch {}

			// Send ping every second to keep the connection alive
			//
			// NOTE: This is required on Cloudflare Workers in order to detect when the connection is closed
			while (true) {
				if (stream.closed || stream.aborted) {
					actor?.rLog.debug({
						msg: "sse stream closed",
						closed: stream.closed,
						aborted: stream.aborted,
					});
					break;
				}

				await stream.writeSSE({ event: "ping", data: "" });
				await stream.sleep(SSE_PING_INTERVAL);
			}
		} catch (error) {
			loggerWithoutContext().error({ msg: "error in sse connection", error });

			// Cleanup on error
			if (conn && actor !== undefined) {
				actor.__connDisconnected(conn, false);
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
			{ [ConnDriverKind.HTTP]: {} },
		);

		// Call action
		const ctx = new ActionContext(actor.actorContext!, conn!);
		output = await actor.executeAction(ctx, actionName, actionArgs);
	} finally {
		if (conn) {
			actor?.__connDisconnected(conn, true);
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

	// TODO: Remvoe any, Hono is being a dumbass
	return c.body(serialized as Uint8Array as any, 200, {
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
