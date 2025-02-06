import * as protoHttpRpc from "@/actor/protocol/http/rpc";
import {
	type ProtocolFormat,
	ProtocolFormatSchema,
} from "@/actor/protocol/ws/mod";
import type { IncomingMessage } from "./connection";
import type * as wsToClient from "@/actor/protocol/ws/to_client";
import type { Logger } from "@/common//log";
import { listObjectMethods } from "@/common//reflect";
import { ActorTags, isJsonSerializable } from "@/common//utils";
import { Hono, HonoRequest, type Context as HonoContext } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { WSContext, WSEvents } from "hono/ws";
import onChange from "on-change";
import { type ActorConfig, mergeActorConfig } from "./actor_config";
import {
	Connection,
	ConnectionTransport,
	type ConnectionId,
	type OutgoingMessage,
} from "./connection";
import type { ActorDriver } from "./driver";
import * as errors from "./errors";
import { handleMessageEvent } from "./event";
import { instanceLogger, logger } from "./log";
import { Rpc } from "./rpc";
import { Lock, assertUnreachable, deadline } from "./utils";
import { Schedule } from "./schedule";
import { KEYS } from "./keys";

/**
 * Options for the `_onBeforeConnect` method.
 *
 * @see {@link https://rivet.gg/docs/connections|Connections Documentation}
 */
export interface OnBeforeConnectOptions<A extends AnyActor> {
	/**
	 * The request object associated with the connection.
	 *
	 * @experimental
	 */
	request: Request;

	/**
	 * The parameters passed when a client connects to the actor.
	 */
	parameters: ExtractActorConnParams<A>;
}

/**
 * Options for the `_saveState` method.
 *
 * @see {@link https://rivet.gg/docs/state|State Documentation}
 */
export interface SaveStateOptions {
	/**
	 * Forces the state to be saved immediately. This function will return when the state has saved successfully.
	 */
	immediate?: boolean;
}

/** Actor type alias with all `any` types. Used for `extends` in classes referencing this actor. */
// biome-ignore lint/suspicious/noExplicitAny: Needs to be used in `extends`
export type AnyActor = Actor<any, any, any>;

export type ExtractActorConnParams<A extends AnyActor> = A extends Actor<
	// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
	any,
	infer ConnParams,
	// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
	any
>
	? ConnParams
	: never;

export type ExtractActorConnState<A extends AnyActor> = A extends Actor<
	// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
	any,
	// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
	any,
	infer ConnState
>
	? ConnState
	: never;

export type ExtractActorState<A> = A extends Actor<infer State> ? State : never;

/**
 * Abstract class representing a Rivet Actor. Extend this class to implement logic for your actor.
 *
 * @template State Represents the actor's state, which is stored in-memory and persisted automatically. This allows you to work with data without added latency while still being able to survive crashes & upgrades. Must define `_onInitialize` to create the initial state. For more details, see the {@link https://rivet.gg/docs/state|State Documentation}.
 * @template ConnParams Represents the parameters passed when a client connects to the actor. These parameters can be used for authentication or other connection-specific logic. For more details, see the {@link https://rivet.gg/docs/connections|Connections Documentation}.
 * @template ConnState Represents the state of a connection, which is initialized from the data returned by `_onBeforeConnect`. This state can be accessed in any actor method using `connection.state`. For more details, see the {@link https://rivet.gg/docs/connections|Connections Documentation}.
 * @see {@link https://rivet.gg/docs|Documentation}
 * @see {@link https://rivet.gg/docs/setup|Initial Setup}
 * @see {@link https://rivet.gg/docs/manage|Create & Manage Actors}
 * @see {@link https://rivet.gg/docs/rpc|Remote Procedure Calls}
 * @see {@link https://rivet.gg/docs/state|State}
 * @see {@link https://rivet.gg/docs/events|Events}
 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle}
 * @see {@link https://rivet.gg/docs/connections|Connections}
 * @see {@link https://rivet.gg/docs/authentication|Authentication}
 * @see {@link https://rivet.gg/docs/logging|Logging}
 */
export abstract class Actor<
	State = undefined,
	ConnParams = undefined,
	ConnState = undefined,
> {
	// Store the init promise so network requests can await initialization
	#initializedPromise?: Promise<void>;

	#stateChanged = false;

	/**
	 * The proxied state that notifies of changes automatically.
	 *
	 * If the object can't be proxied then this value will not be a proxy.
	 */
	#stateProxy!: State;

	/** Raw state without the proxy wrapper */
	#stateRaw!: State;

	//#server?: Deno.HttpServer<Deno.NetAddr>;
	#backgroundPromises: Promise<void>[] = [];
	#config: ActorConfig;
	#driver!: ActorDriver;
	#tags!: ActorTags;
	#region!: string;
	#ready = false;

	#connectionIdCounter = 0;
	#connections = new Map<ConnectionId, Connection<this>>();
	#eventSubscriptions = new Map<string, Set<Connection<this>>>();

	#schedule!: Schedule;

	#lastSaveTime = 0;
	#pendingSaveTimeout?: number | NodeJS.Timeout;

	public __router!: Hono;

	/**
	 * This constructor should never be used directly.
	 *
	 * Constructed in {@link Actor.start}.
	 *
	 * @private
	 */
	public constructor(config?: Partial<ActorConfig>) {
		this.#config = mergeActorConfig(config);
	}

	async __start(driver: ActorDriver, tags: ActorTags, region: string) {
		this.#driver = driver;
		this.#tags = tags;
		this.#region = region;
		this.#schedule = new Schedule(this, driver);

		this.__router = this.#buildRouter();

		// Initialize server
		//
		// Store the promise so network requests can await initialization
		this.#initializedPromise = this.#initializeState();
		await this.#initializedPromise;
		this.#initializedPromise = undefined;

		// TODO: Exit process if this errors
		logger().info("starting");
		await this._onStart?.();

		logger().info("ready");
		this.#ready = true;
	}

	async __onAlarm() {
		await this.#schedule.__onAlarm();
	}

	get #stateEnabled() {
		return typeof this._onInitialize === "function";
	}

	#validateStateEnabled() {
		if (!this.#stateEnabled) {
			throw new errors.StateNotEnabled();
		}
	}

	get #connectionStateEnabled() {
		return typeof this._onBeforeConnect === "function";
	}

	#saveStateLock = new Lock<void>(void 0);

	/** Promise used to wait for a save to complete. This is required since you cannot await `#saveStateThrottled`. */
	#onStateSavedPromise?: PromiseWithResolvers<void>;

	/** Throttled save state method. Used to write to KV at a reasonable cadence. */
	#saveStateThrottled() {
		const now = Date.now();
		const timeSinceLastSave = now - this.#lastSaveTime;
		const saveInterval = this.#config.state.saveInterval;

		// If we're within the throttle window and not already scheduled, schedule the next save.
		if (timeSinceLastSave < saveInterval) {
			if (this.#pendingSaveTimeout === undefined) {
				this.#pendingSaveTimeout = setTimeout(() => {
					this.#pendingSaveTimeout = undefined;
					this.#saveStateInner();
				}, saveInterval - timeSinceLastSave);
			}
		} else {
			// If we're outside the throttle window, save immediately
			this.#saveStateInner();
		}
	}

	/** Saves the state to KV. You probably want to use #saveStateThrottled instead except for a few edge cases. */
	async #saveStateInner() {
		try {
			this.#lastSaveTime = Date.now();

			if (this.#stateChanged) {
				// Use a lock in order to avoid race conditions with multiple
				// parallel promises writing to KV. This should almost never happen
				// unless there are abnormally high latency in KV writes.
				await this.#saveStateLock.lock(async () => {
					logger().debug("saving state");

					// There might be more changes while we're writing, so we set this
					// before writing to KV in order to avoid a race condition.
					this.#stateChanged = false;

					// Write to KV
					await this.#driver.kvPut(KEYS.STATE.DATA, this.#stateRaw);

					logger().debug("state saved");
				});
			}

			this.#onStateSavedPromise?.resolve();
		} catch (error) {
			this.#onStateSavedPromise?.reject(error);
			throw error;
		}
	}

	/** Updates the state and creates a new proxy. */
	#setStateWithoutChange(value: State) {
		if (!isJsonSerializable(value)) {
			throw new errors.InvalidStateType();
		}
		this.#stateProxy = this.#createStateProxy(value);
		this.#stateRaw = value;
	}

	#createStateProxy(target: State): State {
		// If this can't be proxied, return raw value
		if (target === null || typeof target !== "object") {
			if (!isJsonSerializable(target)) {
				throw new errors.InvalidStateType();
			}
			return target;
		}

		// Unsubscribe from old state
		if (this.#stateProxy) {
			onChange.unsubscribe(this.#stateProxy);
		}

		// Listen for changes to the object in order to automatically write state
		return onChange(
			target,
			// biome-ignore lint/suspicious/noExplicitAny: Don't know types in proxy
			(path: any, value: any, _previousValue: any, _applyData: any) => {
				if (!isJsonSerializable(value)) {
					throw new errors.InvalidStateType({ path });
				}
				this.#stateChanged = true;

				// Call onStateChange if it exists
				if (this._onStateChange && this.#ready) {
					try {
						this._onStateChange(this.#stateRaw);
					} catch (error) {
						logger().error("error in `_onStateChange`", {
							error: `${error}`,
						});
					}
				}

				// State will be flushed at the end of the RPC
			},
			{
				ignoreDetached: true,
			},
		);
	}

	async #initializeState() {
		if (!this.#stateEnabled) {
			logger().debug("state not enabled");
			return;
		}
		if (!this._onInitialize) throw new Error("missing _onInitialize");

		// Read initial state
		const [[_i, initialized], [_s, stateData]] = (await this.#driver.kvGetBatch(
			[KEYS.STATE.INITIALIZED, KEYS.STATE.DATA],
		)) as [[any, boolean], [any, State]];

		if (!initialized) {
			// Initialize
			logger().info("initializing");
			const stateOrPromise = await this._onInitialize();

			let stateData: State;
			if (stateOrPromise instanceof Promise) {
				stateData = await stateOrPromise;
			} else {
				stateData = stateOrPromise;
			}

			// Update state
			logger().debug("writing state");
			await this.#driver.kvPutBatch([
				[KEYS.STATE.INITIALIZED, true],
				[KEYS.STATE.DATA, stateData],
			]);
			this.#setStateWithoutChange(stateData);
		} else {
			// Save state
			logger().debug("already initialized");
			this.#setStateWithoutChange(stateData);
		}
	}

	#buildRouter() {
		const app = new Hono();

		app.get("/", (c) => {
			// TODO: Give the metadata about this actor (ie tags)
			return c.text("This is a Rivet Actor\n\nLearn more at https://rivet.gg");
		});

		if (this.#driver.upgradeWebSocket) {
			app.get(
				"/connect/websocket",
				this.#driver.upgradeWebSocket(this.#handleWebSocket.bind(this)),
			);
		} else {
			app.get("/connect/websocket", (c) => {
				return c.text(
					"WebSockets are not enabled for this driver. Use SSE instead.",
					400,
				);
			});
		}

		app.get("/connect/sse", this.#handleSse.bind(this));

		app.post("/rpc/:rpc", this.#handleHttpRpc.bind(this));

		app.post(
			"/connections/:conn/message",
			this.#handleHttpConnectionMessage.bind(this),
		);

		app.all("*", (c) => {
			return c.text(`Not Found (actor) (${c.req.path})`, 404);
		});

		return app;
	}

	/**
	 * Removes a connection and cleans up its resources.
	 */
	#removeConnection(conn: Connection<this> | undefined) {
		if (!conn) {
			logger().warn("`conn` does not exist");
			return;
		}

		this.#connections.delete(conn.id);

		// Remove subscriptions
		for (const eventName of [...conn.subscriptions.values()]) {
			this.#removeSubscription(eventName, conn);
		}

		this._onDisconnect?.(conn);
	}

	async #handleHttpRpc(c: HonoContext) {
		const rpcName = c.req.param("rpc");
		let conn: Connection<this> | undefined;
		try {
			// Wait for init to finish
			if (this.#initializedPromise) await this.#initializedPromise;

			// Parse connection parameters and validate protocol
			const { protocolFormat, connState } =
				await this.#prepareConnectionFromRequest(c, {
					defaultFormat: "json",
				});

			// Create connection with validated parameters
			conn = await this.#createConnection(protocolFormat, connState, {
				http: {},
			});

			// Parse request body if present
			const contentLength = Number(c.req.header("content-length") || "0");
			if (contentLength > this.#config.protocol.maxIncomingMessageSize) {
				throw new errors.MessageTooLong();
			}

			// Parse request body according to protocol format
			const body = await c.req.json();
			const { data: message, success } =
				protoHttpRpc.RequestSchema.safeParse(body);
			if (!success) {
				throw new errors.MalformedMessage("Invalid request format");
			}
			const args = message.a;

			// Create RPC context with the temporary connection
			const ctx = new Rpc<this>(conn);
			const output = await this.#executeRpc(ctx, rpcName, args);

			// Format response according to protocol
			return c.json({
				o: output,
			} satisfies protoHttpRpc.ResponseOk);
		} catch (error) {
			// Build response error information similar to WebSocket handling
			let status: ContentfulStatusCode;
			let code: string;
			let message: string;
			let metadata: unknown = undefined;

			if (error instanceof errors.ActorError && error.public) {
				logger().info("http rpc public error", {
					rpc: rpcName,
					error,
				});

				status = 400;
				code = error.code;
				message = String(error);
				metadata = error.metadata;
			} else {
				logger().warn("http rpc internal error", {
					rpc: rpcName,
					error,
				});

				status = 500;
				code = errors.INTERNAL_ERROR_CODE;
				message = errors.INTERNAL_ERROR_DESCRIPTION;
				metadata = {
					//url: `https://hub.rivet.gg/projects/${this.#driver.metadata.project.slug}/environments/${this.#driver.metadata.environment.slug}/actors?actorId=${this.#driver.metadata.actor.id}`,
				} satisfies errors.InternalErrorMetadata;
			}

			return c.json(
				{
					c: code,
					m: message,
					md: metadata,
				} satisfies protoHttpRpc.ResponseErr,
				{ status },
			);
		} finally {
			this.#removeConnection(conn);
		}
	}

	/** Handles a message sent to a connection over HTTP. */
	async #handleHttpConnectionMessage(c: HonoContext) {
		// Wait for init to finish
		if (this.#initializedPromise) await this.#initializedPromise;

		try {
			const protocolFormat = this.#getRequestProtocolFormat(c.req);

			const connectionId = c.req.param("conn");
			const connectionToken = c.req.query("connectionToken");
			if (!connectionToken) throw new errors.IncorrectConnectionToken();

			// Find connection
			const conn = this._connections.get(parseInt(connectionId));
			if (!conn) {
				throw new errors.ConnectionNotFound(connectionId);
			}

			// Authenticate connection
			if (conn._token !== connectionToken) {
				throw new errors.IncorrectConnectionToken();
			}

			// Parse request body if present
			const contentLength = Number(c.req.header("content-length") || "0");
			if (contentLength > this.#config.protocol.maxIncomingMessageSize) {
				throw new errors.MessageTooLong();
			}

			let value: IncomingMessage;
			if (protocolFormat === "json") {
				// Handle decoding JSON in handleMessageEvent
				value = await c.req.text();
			} else if (protocolFormat === "cbor") {
				value = await c.req.arrayBuffer();
			} else {
				assertUnreachable(protocolFormat);
			}

			// Handle message
			await handleMessageEvent(value, conn, this.#config, {
				onExecuteRpc: async (ctx, name, args) => {
					return await this.#executeRpc(ctx, name, args);
				},
				onSubscribe: async (eventName, conn) => {
					this.#addSubscription(eventName, conn);
				},
				onUnsubscribe: async (eventName, conn) => {
					this.#removeSubscription(eventName, conn);
				},
			});

			// Not data to return
			return c.json({});
		} catch (error) {
			// Build response error information similar to WebSocket handling
			let status: ContentfulStatusCode;
			let code: string;
			let message: string;
			let metadata: unknown = undefined;

			if (error instanceof errors.ActorError && error.public) {
				logger().info("http rpc public error", {
					error,
				});

				status = 400;
				code = error.code;
				message = String(error);
				metadata = error.metadata;
			} else {
				logger().warn("http rpc internal error", {
					error,
				});

				status = 500;
				code = errors.INTERNAL_ERROR_CODE;
				message = errors.INTERNAL_ERROR_DESCRIPTION;
				metadata = {
					//url: `https://hub.rivet.gg/projects/${this.#driver.metadata.project.slug}/environments/${this.#driver.metadata.environment.slug}/actors?actorId=${this.#driver.metadata.actor.id}`,
				} satisfies errors.InternalErrorMetadata;
			}

			return c.json(
				{
					c: code,
					m: message,
					md: metadata,
				} satisfies protoHttpRpc.ResponseErr,
				{ status },
			);
		}
	}

	/**
	 * Called before accepting the socket. Any errors thrown here will cancel the request.
	 */
	async #prepareConnectionFromRequest(
		c: HonoContext,
		opts?: { defaultFormat?: string },
	): Promise<{
		protocolFormat: ProtocolFormat;
		connState: ConnState | undefined;
	}> {
		const protocolFormat = this.#getRequestProtocolFormat(
			c.req,
			opts?.defaultFormat,
		);

		// Validate params size
		const paramsStr = c.req.query("params");
		if (
			paramsStr &&
			paramsStr.length > this.#config.protocol.maxConnectionParametersSize
		) {
			logger().warn("connection parameters too long");
			throw new errors.ConnectionParametersTooLong();
		}

		// Parse and validate params
		let params: ExtractActorConnParams<this>;
		try {
			params =
				typeof paramsStr === "string" ? JSON.parse(paramsStr) : undefined;
		} catch (error) {
			logger().warn("malformed connection parameters", {
				error: `${error}`,
			});
			throw new errors.MalformedConnectionParameters(error);
		}

		// Authenticate connection
		let connState: ConnState | undefined = undefined;
		const PREPARE_CONNECT_TIMEOUT = 5000; // 5 seconds
		if (this._onBeforeConnect) {
			const dataOrPromise = this._onBeforeConnect({
				request: c.req.raw,
				parameters: params,
			});
			if (dataOrPromise instanceof Promise) {
				connState = await deadline(dataOrPromise, PREPARE_CONNECT_TIMEOUT);
			} else {
				connState = dataOrPromise;
			}
		}

		return { protocolFormat, connState };
	}

	#getRequestProtocolFormat(
		c: HonoRequest,
		defaultFormat?: string,
	): ProtocolFormat {
		const protocolFormatRaw = c.query("protocol") ?? defaultFormat;
		const { data: protocolFormat, success } =
			ProtocolFormatSchema.safeParse(protocolFormatRaw);
		if (!success) {
			logger().warn("invalid protocol format", {
				protocolFormat: protocolFormatRaw,
			});
			throw new errors.InvalidProtocolFormat(protocolFormatRaw);
		}

		return protocolFormat;
	}

	/**
	 * Called after establishing a connection handshake.
	 */
	async #createConnection(
		protocolFormat: ProtocolFormat,
		state: ConnState | undefined,
		driver: ConnectionTransport,
	): Promise<Connection<this>> {
		// Create connection
		const connectionId = this.#connectionIdCounter;
		this.#connectionIdCounter += 1;
		const conn = new Connection<Actor<State, ConnParams, ConnState>>(
			connectionId,
			driver,
			protocolFormat,
			state,
			this.#connectionStateEnabled,
		);
		this.#connections.set(conn.id, conn);

		// Handle connection
		const CONNECT_TIMEOUT = 5000; // 5 seconds
		if (this._onConnect) {
			const voidOrPromise = this._onConnect(conn);
			if (voidOrPromise instanceof Promise) {
				deadline(voidOrPromise, CONNECT_TIMEOUT).catch((error) => {
					logger().error("error in `_onConnect`, closing socket", {
						error,
					});
					conn?.disconnect("`onConnect` failed");
				});
			}
		}

		return conn;
	}

	//#getServerPort(): number {
	//	const portStr = Deno.env.get("PORT_HTTP");
	//	if (!portStr) {
	//		throw "Missing port";
	//	}
	//	const port = Number.parseInt(portStr);
	//	if (!Number.isFinite(port)) {
	//		throw "Invalid port";
	//	}
	//
	//	return port;
	//}

	// MARK: RPC
	#isValidRpc(rpcName: string): boolean {
		// Prevent calling private methods
		if (rpcName.startsWith("#")) return false;

		// Prevent accidental leaking of private methods, since this is a common
		// convention
		if (rpcName.startsWith("_")) return false;

		// Prevent calling protected methods
		// TODO: Are there other RPC functions that should be private? i.e.	internal JS runtime functions? Should we validate the fn is part of this prototype?
		const reservedMethods = ["constructor", "initialize", "run"];
		if (reservedMethods.includes(rpcName)) return false;

		return true;
	}

	// MARK: Events
	#addSubscription(eventName: string, connection: Connection<this>) {
		connection.subscriptions.add(eventName);
		let subscribers = this.#eventSubscriptions.get(eventName);
		if (!subscribers) {
			subscribers = new Set();
			this.#eventSubscriptions.set(eventName, subscribers);
		}
		subscribers.add(connection);
	}

	#removeSubscription(eventName: string, connection: Connection<this>) {
		connection.subscriptions.delete(eventName);
		const subscribers = this.#eventSubscriptions.get(eventName);
		if (subscribers) {
			subscribers.delete(connection);
			if (subscribers.size === 0) {
				this.#eventSubscriptions.delete(eventName);
			}
		}
	}
	async #handleWebSocket(c: HonoContext): Promise<WSEvents<WebSocket>> {
		// Wait for init to finish
		if (this.#initializedPromise) await this.#initializedPromise;

		// Parse connection parameters and validate protocol
		const { protocolFormat, connState } =
			await this.#prepareConnectionFromRequest(c);

		let conn: Connection<this> | undefined;

		// Create connection once we have the WebSocket objects. This isn't available on all drivers (e.g. Cloudflare Workers).
		//
		// See https://hono.dev/docs/helpers/websocket#upgradewebsocket
		const lazyOnOpen = async (ws: WSContext<WebSocket>) => {
			if (!conn) {
				logger().debug("socket open");

				// Create connection with validated parameters
				conn = await this.#createConnection(protocolFormat, connState, {
					websocket: ws,
				});
			}
		};

		return {
			onOpen: async (_evt, ws) => {
				// onOpen doesn't get triggered on all drivers (e.g. Cloudflare Workers)

				await lazyOnOpen(ws);
			},
			onMessage: async (evt, ws) => {
				await lazyOnOpen(ws);

				logger().debug("received message");

				if (!conn) {
					logger().warn("`conn` does not exist");
					return;
				}

				const value = evt.data.valueOf() as IncomingMessage;
				await handleMessageEvent(value, conn, this.#config, {
					onExecuteRpc: async (ctx, name, args) => {
						return await this.#executeRpc(ctx, name, args);
					},
					onSubscribe: async (eventName, conn) => {
						this.#addSubscription(eventName, conn);
					},
					onUnsubscribe: async (eventName, conn) => {
						this.#removeSubscription(eventName, conn);
					},
				});
			},
			onClose: async (_evt, ws) => {
				await lazyOnOpen(ws);

				this.#removeConnection(conn);
			},
			onError: async (error, ws) => {
				await lazyOnOpen(ws);

				// Actors don't need to know about this, since it's abstracted
				// away
				logger().warn("websocket error", { error: `${error}` });
			},
		};
	}

	async #handleSse(c: HonoContext) {
		// Wait for init to finish
		if (this.#initializedPromise) await this.#initializedPromise;

		// Parse connection parameters and validate protocol
		const { protocolFormat, connState } =
			await this.#prepareConnectionFromRequest(c);

		return streamSSE(
			c,
			async (stream) => {
				// Create connection with validated parameters
				logger().debug("socket open");
				const conn = await this.#createConnection(protocolFormat, connState, {
					sse: stream,
				});

				const { promise, resolve } = Promise.withResolvers();

				stream.onAbort(() => {
					// Close connection
					this.#removeConnection(conn);

					resolve(undefined);
				});

				conn._sendMessage(
					conn._serialize({
						b: {
							i: {
								ci: `${conn.id}`,
								ct: conn._token,
							},
						},
					}),
				);

				await promise;
			},
			async (error) => {
				// Actors don't need to know about this, since it's abstracted
				// away
				logger().warn("sse error", { error: `${error}` });
			},
		);
	}

	#assertReady() {
		if (!this.#ready) throw new errors.InternalError("Actor not ready");
	}

	async #executeRpc(
		ctx: Rpc<this>,
		rpcName: string,
		args: unknown[],
	): Promise<unknown> {
		// Prevent calling private or reserved methods
		if (!this.#isValidRpc(rpcName)) {
			logger().warn("attempted to call invalid rpc", { rpcName });
			throw new errors.RpcNotFound();
		}

		// Check if the method exists on this object
		// biome-ignore lint/suspicious/noExplicitAny: RPC name is dynamic from client
		const rpcFunction = (this as any)[rpcName];
		if (typeof rpcFunction !== "function") {
			logger().warn("rpc not found", { rpcName });
			throw new errors.RpcNotFound();
		}

		// TODO: pass abortable to the rpc to decide when to abort
		// TODO: Manually call abortable for better error handling
		// Call the function on this object with those arguments
		try {
			const outputOrPromise = rpcFunction.call(this, ctx, ...args);
			if (outputOrPromise instanceof Promise) {
				return await this._onBeforeRpcResponse(
					rpcName,
					args,
					await deadline(outputOrPromise, this.#config.rpc.timeout),
				);
			}
			return await this._onBeforeRpcResponse(rpcName, args, outputOrPromise);
		} catch (error) {
			if (error instanceof DOMException && error.name === "TimeoutError") {
				throw new errors.RpcTimedOut();
			}
			throw error;
		} finally {
			this.#saveStateThrottled();
		}
	}

	get #rpcNames(): string[] {
		return listObjectMethods(this).filter(
			(name): name is string =>
				typeof name === "string" && this.#isValidRpc(name),
		);
	}

	// MARK: Lifecycle hooks
	/**
	 * Hook called when the actor is first created. This method should return the initial state of the actor. The state can be access with `this._state`.
	 *
	 * @see _state
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 */
	protected _onInitialize?(): State | Promise<State>;

	/**
	 * Hook called after the actor has been initialized but before any connections are accepted. If the actor crashes or is upgraded, this method will be called before startup. If you need to upgrade your state, use this method.
	 *
	 * Use this to set up any resources or start any background tasks.
	 *
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 */
	protected _onStart?(): void | Promise<void>;

	/**
	 * Hook called whenever the actor's state changes. This is often used to broadcast state updates.
	 *
	 * @param newState - The new state.
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 */
	protected _onStateChange?(newState: State): void | Promise<void>;

	/**
	 * Hook called after the RPC method is executed, but before the response is sent.
	 *
	 * This is useful for logging or auditing RPC calls.
	 *
	 * @internal
	 * @private
	 * @param _name - The name of the called RPC method.
	 * @param _args - The arguments passed to the RPC method.
	 * @param output - The output of the RPC method.
	 *
	 * @returns The output of the RPC method.
	 */
	protected _onBeforeRpcResponse<Out>(
		_name: string,
		_args: unknown[],
		output: Out,
	): Out {
		return output;
	}

	/**
	 * Called whenever a new client connects to the actor. Clients can pass parameters when connecting, accessible via `opts.parameters`.
	 *
	 * The returned value becomes the connection's initial state and can be accessed later via `connection.state`.
	 *
	 * Connections cannot interact with the actor until this method completes successfully. Throwing an error will abort the connection.
	 *
	 * @param opts - Options for the connection.
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 * @see {@link https://rivet.gg/docs/authentication|Authentication Documentation}
	 */
	protected _onBeforeConnect?(
		opts: OnBeforeConnectOptions<this>,
	): ConnState | Promise<ConnState>;

	/**
	 * Executed after the client has successfully connected.
	 *
	 * Messages will not be processed for this actor until this method succeeds.
	 *
	 * Errors thrown from this method will cause the client to disconnect.
	 *
	 * @param connection - The connection object.
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 */
	protected _onConnect?(connection: Connection<this>): void | Promise<void> {}

	/**
	 * Called when a client disconnects from the actor. Use this to clean up any connection-specific resources.
	 *
	 * @param connection - The connection object.
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 */
	protected _onDisconnect?(
		connection: Connection<this>,
	): void | Promise<void> {}

	// MARK: Exposed methods
	/**
	 * Gets metadata associated with this actor.
	 *
	 * @see {@link https://rivet.gg/docs/metadata|Metadata Documentation}
	 */
	//protected get _metadata(): Metadata {
	//	return this.#driver.metadata;
	//}

	/**
	 * Gets the KV state API. This KV storage is local to this actor.
	 *
	 * @see {@link https://rivet.gg/docs/state|State Documentation}
	 */
	//protected get _kv(): Kv {
	//	return this.#driver.kv;
	//}

	/**
	 * Gets the logger instance.
	 *
	 * @see {@link https://rivet.gg/docs/logging|Logging Documentation}
	 */
	protected get _log(): Logger {
		return instanceLogger();
	}

	/**
	 * Gets the tags.
	 */
	protected get _tags(): ActorTags {
		return this.#tags;
	}

	/**
	 * Gets the region.
	 */
	protected get _region(): string {
		return this.#region;
	}

	/**
	 * Gets the scheduler.
	 */
	protected get _schedule(): Schedule {
		return this.#schedule;
	}

	/**
	 * Gets the map of connections.
	 *
	 * @see {@link https://rivet.gg/docs/connections|Connections Documentation}
	 */
	protected get _connections(): Map<ConnectionId, Connection<this>> {
		return this.#connections;
	}

	/**
	 * Gets the current state.
	 *
	 * Changing properties of this value will automatically be persisted.
	 *
	 * @see _onInitialize
	 * @see {@link https://rivet.gg/docs/state|State Documentation}
	 */
	protected get _state(): State {
		this.#validateStateEnabled();
		return this.#stateProxy;
	}

	/**
	 * Sets the current state.
	 *
	 * This property will automatically be persisted.
	 *
	 * @see {@link https://rivet.gg/docs/state|State Documentation}
	 */
	protected set _state(value: State) {
		this.#validateStateEnabled();
		this.#setStateWithoutChange(value);
		this.#stateChanged = true;
	}

	/**
	 * Broadcasts an event to all connected clients.
	 * @param name - The name of the event.
	 * @param args - The arguments to send with the event.
	 * @see {@link https://rivet.gg/docs/events|Events}
	 */
	protected _broadcast<Args extends Array<unknown>>(
		name: string,
		...args: Args
	) {
		this.#assertReady();

		// Send to all connected clients
		const subscriptions = this.#eventSubscriptions.get(name);
		if (!subscriptions) return;

		const toClient: wsToClient.ToClient = {
			b: {
				ev: {
					n: name,
					a: args,
				},
			},
		};

		// Send message to clients
		const serialized: Record<string, OutgoingMessage> = {};
		for (const connection of subscriptions) {
			// Lazily serialize the appropriate format
			if (!(connection._protocolFormat in serialized)) {
				serialized[connection._protocolFormat] =
					connection._serialize(toClient);
			}

			connection._sendMessage(serialized[connection._protocolFormat]);
		}
	}

	/**
	 * Runs a promise in the background.
	 *
	 * This allows the actor runtime to ensure that a promise completes while
	 * returning from an RPC request early.
	 *
	 * @param promise - The promise to run in the background.
	 */
	protected _runInBackground(promise: Promise<void>) {
		this.#assertReady();

		// TODO: Should we force save the state?
		// Add logging to promise and make it non-failable
		const nonfailablePromise = promise
			.then(() => {
				logger().debug("background promise complete");
			})
			.catch((error) => {
				logger().error("background promise failed", {
					error: `${error}`,
				});
			});
		this.#backgroundPromises.push(nonfailablePromise);
	}

	/**
	 * Forces the state to get saved.
	 *
	 * This is helpful if running a long task that may fail later or when
	 * running a background job that updates the state.
	 *
	 * @param opts - Options for saving the state.
	 * @see {@link https://rivet.gg/docs/state|State Documentation}
	 */
	protected async _saveState(opts: SaveStateOptions) {
		this.#assertReady();

		if (this.#stateChanged) {
			if (opts.immediate) {
				// Save immediately
				await this.#saveStateInner();
			} else {
				// Create callback
				if (!this.#onStateSavedPromise) {
					this.#onStateSavedPromise = Promise.withResolvers();
				}

				// Save state throttled
				this.#saveStateThrottled();

				// Wait for save
				await this.#onStateSavedPromise.promise;
			}
		}
	}

	/**
	 * Shuts down the actor, closing all connections and stopping the server.
	 *
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 */
	protected async _shutdown() {
		//// Stop accepting new connections
		//if (this.#server) await this.#server.shutdown();

		// Disconnect existing connections
		const promises: Promise<unknown>[] = [];
		for (const connection of this.#connections.values()) {
			promises.push(connection.shutdown());

			// TODO: Figure out how to abort HTTP requests on shutdown
		}

		// Await all `close` event listeners with 1.5 second timeout
		const res = Promise.race([
			Promise.all(promises).then(() => false),
			new Promise<boolean>((res) =>
				globalThis.setTimeout(() => res(true), 1500),
			),
		]);

		if (await res) {
			logger().warn(
				"timed out waiting for connections to close, shutting down anyway",
			);
		}

		// TODO:
		//Deno.exit(0);
	}
}
