import type { Transport } from "@/actor/protocol/message/mod";
import type { Encoding } from "@/actor/protocol/serde";
import type { ActorTags } from "@/common//utils";
import type {
	ActorsRequest,
	ActorsResponse,
	//RivetConfigResponse,
} from "@/manager/protocol/mod";
import type { CreateRequest } from "@/manager/protocol/query";
import * as errors from "./errors";
import {
	ActorConn,
	ActorConnRaw,
	ActorRPCFunction,
	CONNECT_SYMBOL,
} from "./actor_conn";
import { logger } from "./log";
import { importWebSocket } from "@/common/websocket";
import { importEventSource } from "@/common/eventsource";
import { ActorCoreApp } from "@/mod";
import type { AnyActorDefinition } from "@/actor/definition";

/** Extract the actor registry from the app definition. */
export type ExtractActorsFromApp<A extends ActorCoreApp<any>> =
	A extends ActorCoreApp<infer Actors> ? Actors : never;

/** Extract the app definition from the client. */
export type ExtractAppFromClient<C extends Client<ActorCoreApp<{}>>> =
	C extends Client<infer A> ? A : never;

/**
 * Represents an actor accessor that provides methods to interact with a specific actor.
 */
export interface ActorAccessor<AD extends AnyActorDefinition> {
	/**
	 * Connects to an actor by its tags, creating it if necessary.
	 * The actor name is automatically injected from the property accessor.
	 *
	 * @template A The actor class that this connection is for.
	 * @param {ActorTags} [tags={}] - The tags to identify the actor. Defaults to an empty object.
	 * @param {GetOptions} [opts] - Options for getting the actor.
	 * @returns {Promise<ActorConn<AD>>} - A promise resolving to the actor connection.
	 */
	connect(tags?: ActorTags, opts?: GetOptions): Promise<ActorConn<AD>>;

	/**
	 * Creates a new actor with the name automatically injected from the property accessor,
	 * and connects to it.
	 *
	 * @template A The actor class that this connection is for.
	 * @param {CreateOptions} opts - Options for creating the actor (excluding name and tags).
	 * @param {ActorTags} [tags={}] - The tags to identify the actor. Defaults to an empty object.
	 * @returns {Promise<ActorConn<AD>>} - A promise resolving to the actor connection.
	 */
	createAndConnect(opts: CreateOptions, tags?: ActorTags): Promise<ActorConn<AD>>;

	/**
	 * Connects to an actor by its ID.
	 *
	 * @template A The actor class that this connection is for.
	 * @param {string} actorId - The ID of the actor.
	 * @param {GetWithIdOptions} [opts] - Options for getting the actor.
	 * @returns {Promise<ActorConn<AD>>} - A promise resolving to the actor connection.
	 */
	connectForId(actorId: string, opts?: GetWithIdOptions): Promise<ActorConn<AD>>;
}

/**
 * Options for configuring the client.
 * @typedef {Object} ClientOptions
 */
export interface ClientOptions {
	encoding?: Encoding;
	supportedTransports?: Transport[];
}

/**
 * Options for querying actors.
 * @typedef {Object} QueryOptions
 * @property {unknown} [parameters] - Parameters to pass to the connection.
 */
export interface QueryOptions {
	/** Parameters to pass to the connection. */
	params?: unknown;
}

/**
 * Options for getting an actor by ID.
 * @typedef {QueryOptions} GetWithIdOptions
 */
export interface GetWithIdOptions extends QueryOptions {}

/**
 * Options for getting an actor.
 * @typedef {QueryOptions} GetOptions
 * @property {boolean} [noCreate] - Prevents creating a new actor if one does not exist.
 * @property {Partial<CreateRequest>} [create] - Config used to create the actor.
 */
export interface GetOptions extends QueryOptions {
	/** Prevents creating a new actor if one does not exist. */
	noCreate?: boolean;
	/** Config used to create the actor. */
	create?: Partial<Omit<CreateRequest, "name">>;
}

/**
 * Options for creating an actor.
 * @typedef {QueryOptions} CreateOptions
 * @property {Object} - Additional options for actor creation excluding name and tags that come from the tags parameter.
 */
export interface CreateOptions extends QueryOptions, Omit<CreateRequest, "name" | "tags"> {}

/**
 * Represents a region to connect to.
 * @typedef {Object} Region
 * @property {string} id - The region ID.
 * @property {string} name - The region name.
 * @see {@link https://rivet.gg/docs/edge|Edge Networking}
 * @see {@link https://rivet.gg/docs/regions|Available Regions}
 */
export interface Region {
	/**
	 * The region slug.
	 */
	id: string;

	/**
	 * The human-friendly region name.
	 */
	name: string;
}

export interface DynamicImports {
	WebSocket: typeof WebSocket;
	EventSource: typeof EventSource;
}

export const ACTOR_CONNS_SYMBOL = Symbol("actorConns");

/**
 * Client for managing & connecting to actors.
 *
 * @template A The actors map type that defines the available actors.
 * @see {@link https://rivet.gg/docs/manage|Create & Manage Actors}
 */
export class ClientRaw {
	#disposed = false;

	[ACTOR_CONNS_SYMBOL] = new Set<ActorConnRaw>();

	#managerEndpointPromise: Promise<string>;
	//#regionPromise: Promise<Region | undefined>;
	#encodingKind: Encoding;
	#supportedTransports: Transport[];

	// External imports
	#dynamicImportsPromise: Promise<DynamicImports>;

	/**
	 * Creates an instance of Client.
	 *
	 * @param {string | Promise<string>} managerEndpointPromise - The manager endpoint or a promise resolving to it. See {@link https://rivet.gg/docs/setup|Initial Setup} for instructions on getting the manager endpoint.
	 * @param {ClientOptions} [opts] - Options for configuring the client.
	 * @see {@link https://rivet.gg/docs/setup|Initial Setup}
	 */
	public constructor(
		managerEndpointPromise: string | Promise<string>,
		opts?: ClientOptions,
	) {
		if (managerEndpointPromise instanceof Promise) {
			// Save promise
			this.#managerEndpointPromise = managerEndpointPromise;
		} else {
			// Convert to promise
			this.#managerEndpointPromise = new Promise((resolve) =>
				resolve(managerEndpointPromise),
			);
		}

		//this.#regionPromise = this.#fetchRegion();

		this.#encodingKind = opts?.encoding ?? "cbor";
		this.#supportedTransports = opts?.supportedTransports ?? [
			"websocket",
			"sse",
		];

		// Import dynamic dependencies
		this.#dynamicImportsPromise = (async () => {
			const WebSocket = await importWebSocket();
			const EventSource = await importEventSource();
			return { WebSocket, EventSource };
		})();
	}

	/**
	 * Connects to an actor by its ID.
	 * @template AD The actor class that this connection is for.
	 * @param {string} actorId - The ID of the actor.
	 * @param {GetWithIdOptions} [opts] - Options for getting the actor.
	 * @returns {Promise<ActorConn<AD>>} - A promise resolving to the actor connection.
	 */
	async connectForId<AD extends AnyActorDefinition>(
		actorId: string,
		opts?: GetWithIdOptions,
	): Promise<ActorConn<AD>> {
		logger().debug("connect to actor with id ", {
			actorId,
			params: opts?.params,
		});

		const resJson = await this.#sendManagerRequest<
			ActorsRequest,
			ActorsResponse
		>("POST", "/manager/actors", {
			query: {
				getForId: {
					actorId,
				},
			},
		});

		const conn = await this.#createConn(
			resJson.endpoint,
			opts?.params,
			resJson.supportedTransports,
		);
		return this.#createProxy(conn) as ActorConn<AD>;
	}

	/**
	 * Connects to an actor by its tags, creating it if necessary.
	 *
	 * @example
	 * ```
	 * const room = await client.connect<ChatRoom>(
	 *   // Get or create the actor for the channel `random`
	 *   { name: 'my_document', channel: 'random' },
	 * );
	 *
	 * // This actor will have the tags: { name: 'my_document', channel: 'random' }
	 * await room.sendMessage('Hello, world!');
	 * ```
	 *
	 * @template AD The actor class that this connection is for.
	 * @param {ActorTags} [tags={}] - The tags to identify the actor. Defaults to an empty object.
	 * @param {GetOptions} [opts] - Options for getting the actor.
	 * @returns {Promise<ActorConn<AD>>} - A promise resolving to the actor connection.
	 * @see {@link https://rivet.gg/docs/manage#client.connect}
	 */
	async connect<AD extends AnyActorDefinition>(
		tags: ActorTags = {},
		opts?: GetOptions,
	): Promise<ActorConn<AD>> {
		// Extract name from tags
		const { name, ...restTags } = tags;

		// Build create config
		let create: CreateRequest | undefined = undefined;
		if (!opts?.noCreate) {
			create = {
				name,
				// Fall back to tags defined when querying actor
				tags: opts?.create?.tags ?? restTags,
				...opts?.create,
			};
		}

		logger().debug("connect to actor", {
			tags,
			parameters: opts?.params,
			create,
		});

		const resJson = await this.#sendManagerRequest<
			ActorsRequest,
			ActorsResponse
		>("POST", "/manager/actors", {
			query: {
				getOrCreateForTags: {
					name,
					tags: restTags,
					create,
				},
			},
		});

		const conn = await this.#createConn(
			resJson.endpoint,
			opts?.params,
			resJson.supportedTransports,
		);
		return this.#createProxy(conn) as ActorConn<AD>;
	}

	/**
	 * Creates a new actor with the provided tags and connects to it.
	 *
	 * @example
	 * ```
	 * // Create a new document actor
	 * const doc = await client.createAndConnect<MyDocument>(
	 *   { region: 'us-east-1' },
	 *   { name: 'my_document', docId: '123' }
	 * );
	 *
	 * await doc.doSomething();
	 * ```
	 *
	 * @template AD The actor class that this connection is for.
	 * @param {CreateOptions} opts - Options for creating the actor (excluding name and tags).
	 * @param {ActorTags} [tags={}] - The tags to identify the actor. Defaults to an empty object.
	 * @returns {Promise<ActorConn<AD>>} - A promise resolving to the actor connection.
	 * @see {@link https://rivet.gg/docs/manage#client.createAndConnect}
	 */
	async createAndConnect<AD extends AnyActorDefinition>(
		opts: CreateOptions,
		tags: ActorTags = {},
	): Promise<ActorConn<AD>> {
		// Extract name from tags
		const { name, ...restTags } = tags;

		// Build create config
		const create = {
			name,
			tags: restTags,
			...opts,
		};

		// Default to the chosen region
		//if (!create.region) create.region = (await this.#regionPromise)?.id;

		logger().debug("create actor and connect", {
			tags,
			parameters: opts?.params,
			create,
		});

		const resJson = await this.#sendManagerRequest<
			ActorsRequest,
			ActorsResponse
		>("POST", "/manager/actors", {
			query: {
				create,
			},
		});

		const conn = await this.#createConn(
			resJson.endpoint,
			opts?.params,
			resJson.supportedTransports,
		);
		return this.#createProxy(conn) as ActorConn<AD>;
	}

	async #createConn(
		endpoint: string,
		params: unknown,
		serverTransports: Transport[],
	): Promise<ActorConnRaw> {
		const imports = await this.#dynamicImportsPromise;

		const conn = new ActorConnRaw(
			this,
			endpoint,
			params,
			this.#encodingKind,
			this.#supportedTransports,
			serverTransports,
			imports,
		);
		this[ACTOR_CONNS_SYMBOL].add(conn);
		conn[CONNECT_SYMBOL]();
		return conn;
	}

	#createProxy<AD extends AnyActorDefinition>(
		conn: ActorConnRaw,
	): ActorConn<AD> {
		// Stores returned RPC functions for faster calls
		const methodCache = new Map<string, ActorRPCFunction>();
		return new Proxy(conn, {
			get(target: ActorConnRaw, prop: string | symbol, receiver: unknown) {
				// Handle built-in Symbol properties
				if (typeof prop === "symbol") {
					return Reflect.get(target, prop, receiver);
				}

				// Handle built-in Promise methods and existing properties
				if (
					prop === "then" ||
					prop === "catch" ||
					prop === "finally" ||
					prop === "constructor" ||
					prop in target
				) {
					const value = Reflect.get(target, prop, receiver);
					// Preserve method binding
					if (typeof value === "function") {
						return value.bind(target);
					}
					return value;
				}

				// Create RPC function that preserves 'this' context
				if (typeof prop === "string") {
					let method = methodCache.get(prop);
					if (!method) {
						method = (...args: unknown[]) => target.action(prop, ...args);
						methodCache.set(prop, method);
					}
					return method;
				}
			},

			// Support for 'in' operator
			has(target: ActorConnRaw, prop: string | symbol) {
				// All string properties are potentially RPC functions
				if (typeof prop === "string") {
					return true;
				}
				// For symbols, defer to the target's own has behavior
				return Reflect.has(target, prop);
			},

			// Support instanceof checks
			getPrototypeOf(target: ActorConnRaw) {
				return Reflect.getPrototypeOf(target);
			},

			// Prevent property enumeration of non-existent RPC methods
			ownKeys(target: ActorConnRaw) {
				return Reflect.ownKeys(target);
			},

			// Support proper property descriptors
			getOwnPropertyDescriptor(target: ActorConnRaw, prop: string | symbol) {
				const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, prop);
				if (targetDescriptor) {
					return targetDescriptor;
				}
				if (typeof prop === "string") {
					// Make RPC methods appear non-enumerable
					return {
						configurable: true,
						enumerable: false,
						writable: false,
						value: (...args: unknown[]) => target.action(prop, ...args),
					};
				}
				return undefined;
			},
		}) as ActorConn<AD>;
	}

	/**
	 * Sends an HTTP request to the manager actor.
	 * @private
	 * @template Request
	 * @template Response
	 * @param {string} method - The HTTP method.
	 * @param {string} path - The path for the request.
	 * @param {Request} [body] - The request body.
	 * @returns {Promise<Response>} - A promise resolving to the response.
	 * @see {@link https://rivet.gg/docs/manage#client}
	 */
	async #sendManagerRequest<Request, Response>(
		method: string,
		path: string,
		body?: Request,
	): Promise<Response> {
		try {
			const managerEndpoint = await this.#managerEndpointPromise;
			const res = await fetch(`${managerEndpoint}${path}`, {
				method,
				headers: {
					"Content-Type": "application/json",
				},
				body: body ? JSON.stringify(body) : undefined,
			});

			if (!res.ok) {
				throw new errors.ManagerError(`${res.statusText}: ${await res.text()}`);
			}

			return res.json();
		} catch (error) {
			throw new errors.ManagerError(String(error), { cause: error });
		}
	}

	/**
	 * Disconnects from all actors.
	 *
	 * @returns {Promise<void>} A promise that resolves when the socket is gracefully closed.
	 */
	async dispose(): Promise<void> {
		if (this.#disposed) {
			logger().warn("client already disconnected");
			return;
		}
		this.#disposed = true;

		logger().debug("disposing client");

		const disposePromises = [];
		for (const conn of this[ACTOR_CONNS_SYMBOL].values()) {
			disposePromises.push(conn.dispose());
		}
		await Promise.all(disposePromises);
	}
}

/**
 * Client type with actor accessors.
 * This adds property accessors for actor names to the ClientRaw base class.
 *
 * @template A The actor application type.
 */
export type Client<A extends ActorCoreApp<any>> = ClientRaw & {
	[K in keyof ExtractActorsFromApp<A>]: ActorAccessor<
		ExtractActorsFromApp<A>[K]
	>;
};

/**
 * Creates a client with the actor accessor proxy.
 *
 * @template A The actor application type.
 * @param {string | Promise<string>} managerEndpointPromise - The manager endpoint or a promise resolving to it.
 * @param {ClientOptions} [opts] - Options for configuring the client.
 * @returns {Client<A>} - A proxied client that supports the `client.myActor.connect()` syntax.
 */
export function createClient<A extends ActorCoreApp<any>>(
	managerEndpointPromise: string | Promise<string>,
	opts?: ClientOptions,
): Client<A> {
	const client = new ClientRaw(managerEndpointPromise, opts);

	// Create proxy for accessing actors by name
	return new Proxy(client, {
		get: (target: ClientRaw, prop: string | symbol, receiver: unknown) => {
			// Get the real property if it exists
			if (typeof prop === "symbol" || prop in target) {
				const value = Reflect.get(target, prop, receiver);
				// Preserve method binding
				if (typeof value === "function") {
					return value.bind(target);
				}
				return value;
			}

			// Handle actor accessor for string properties (actor names)
			if (typeof prop === "string") {
				// Return actor accessor object with methods
				return {
					connect: (
						tags?: ActorTags,
						opts?: GetOptions,
					): Promise<ActorConn<ExtractActorsFromApp<A>[typeof prop]>> => {
						return target.connect<ExtractActorsFromApp<A>[typeof prop]>(
							{ name: prop, ...(tags || {}) },
							opts
						);
					},
					createAndConnect: (
						opts: CreateOptions,
						tags?: ActorTags,
					): Promise<ActorConn<ExtractActorsFromApp<A>[typeof prop]>> => {
						return target.createAndConnect<ExtractActorsFromApp<A>[typeof prop]>(
							opts,
							{ name: prop, ...(tags || {}) }
						);
					},
					connectForId: (
						actorId: string,
						opts?: GetWithIdOptions,
					): Promise<ActorConn<ExtractActorsFromApp<A>[typeof prop]>> => {
						return target.connectForId<ExtractActorsFromApp<A>[typeof prop]>(
							actorId,
							opts,
						);
					},
				} as ActorAccessor<ExtractActorsFromApp<A>[typeof prop]>;
			}

			return undefined;
		},
	}) as Client<A>;
}
