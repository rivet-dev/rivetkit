import type {
	ActorConfig as RunnerActorConfig,
	RunnerConfig,
} from "@rivetkit/engine-runner";
import { Runner } from "@rivetkit/engine-runner";
import * as cbor from "cbor-x";
import type { Context as HonoContext } from "hono";
import { streamSSE } from "hono/streaming";
import { WSContext } from "hono/ws";
import invariant from "invariant";
import { lookupInRegistry } from "@/actor/definition";
import { deserializeActorKey } from "@/actor/keys";
import { EncodingSchema } from "@/actor/protocol/serde";
import { type ActorRouter, createActorRouter } from "@/actor/router";
import {
	handleRawWebSocketHandler,
	handleWebSocketConnect,
} from "@/actor/router-endpoints";
import type { Client } from "@/client/client";
import {
	PATH_CONNECT_WEBSOCKET,
	PATH_RAW_WEBSOCKET_PREFIX,
	WS_PROTOCOL_CONN_PARAMS,
	WS_PROTOCOL_ENCODING,
	WS_PROTOCOL_TOKEN,
} from "@/common/actor-router-consts";
import type { UpgradeWebSocketArgs } from "@/common/inline-websocket-adapter2";
import { getLogger } from "@/common/log";
import type { UniversalWebSocket } from "@/common/websocket-interface";
import {
	type ActorDriver,
	type AnyActorInstance,
	type ManagerDriver,
	serializeEmptyPersistData,
} from "@/driver-helpers/mod";
import type { RegistryConfig } from "@/registry/config";
import type { RunConfig } from "@/registry/run-config";
import {
	type LongTimeoutHandle,
	promiseWithResolvers,
	setLongTimeout,
} from "@/utils";
import type { Config } from "./config";
import { KEYS } from "./kv";
import { logger } from "./log";

interface ActorHandler {
	actor?: AnyActorInstance;
	actorStartPromise?: ReturnType<typeof promiseWithResolvers<void>>;
	persistedData?: Uint8Array;
}

export type DriverContext = {};

export class EngineActorDriver implements ActorDriver {
	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#managerDriver: ManagerDriver;
	#inlineClient: Client<any>;
	#config: Config;
	#runner: Runner;
	#actors: Map<string, ActorHandler> = new Map();
	#actorRouter: ActorRouter;
	#version: number = 1; // Version for the runner protocol
	#alarmTimeout?: LongTimeoutHandle;

	#runnerStarted: PromiseWithResolvers<undefined> = Promise.withResolvers();
	#runnerStopped: PromiseWithResolvers<undefined> = Promise.withResolvers();

	constructor(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		managerDriver: ManagerDriver,
		inlineClient: Client<any>,
		config: Config,
	) {
		this.#registryConfig = registryConfig;
		this.#runConfig = runConfig;
		this.#managerDriver = managerDriver;
		this.#inlineClient = inlineClient;
		this.#config = config;
		this.#actorRouter = createActorRouter(
			runConfig,
			this,
			registryConfig.test.enabled,
		);

		// Create runner configuration
		let hasDisconnected = false;
		const runnerConfig: RunnerConfig = {
			version: this.#version,
			endpoint: config.endpoint,
			token: runConfig.token ?? config.token,
			pegboardEndpoint: config.pegboardEndpoint,
			namespace: config.namespace,
			totalSlots: runConfig.totalSlots ?? config.totalSlots,
			runnerName: config.runnerName,
			runnerKey: config.runnerKey,
			metadata: {
				inspectorToken: this.#runConfig.inspector.token(),
			},
			prepopulateActorNames: Object.fromEntries(
				Object.keys(this.#registryConfig.use).map((name) => [
					name,
					{ metadata: {} },
				]),
			),
			onConnected: () => {
				if (hasDisconnected) {
					logger().info({
						msg: "runner reconnected",
						namespace: this.#config.namespace,
						runnerName: this.#config.runnerName,
					});
				} else {
					logger().debug({
						msg: "runner connected",
						namespace: this.#config.namespace,
						runnerName: this.#config.runnerName,
					});
				}

				this.#runnerStarted.resolve(undefined);
			},
			onDisconnected: () => {
				logger().warn({
					msg: "runner disconnected",
					namespace: this.#config.namespace,
					runnerName: this.#config.runnerName,
				});
				hasDisconnected = true;
			},
			onShutdown: () => {
				this.#runnerStopped.resolve(undefined);
			},
			fetch: this.#runnerFetch.bind(this),
			websocket: this.#runnerWebSocket.bind(this),
			onActorStart: this.#runnerOnActorStart.bind(this),
			onActorStop: this.#runnerOnActorStop.bind(this),
			logger: getLogger("engine-runner"),
		};

		// Create and start runner
		this.#runner = new Runner(runnerConfig);
		this.#runner.start();
		logger().debug({
			msg: "engine runner started",
			endpoint: config.endpoint,
			namespace: config.namespace,
			runnerName: config.runnerName,
		});
	}

	async #loadActorHandler(actorId: string): Promise<ActorHandler> {
		// Check if actor is already loaded
		const handler = this.#actors.get(actorId);
		if (!handler) throw new Error(`Actor handler does not exist ${actorId}`);
		if (handler.actorStartPromise) await handler.actorStartPromise.promise;
		if (!handler.actor) throw new Error("Actor should be loaded");
		return handler;
	}

	async loadActor(actorId: string): Promise<AnyActorInstance> {
		const handler = await this.#loadActorHandler(actorId);
		if (!handler.actor) throw new Error(`Actor ${actorId} failed to load`);
		return handler.actor;
	}

	getContext(actorId: string): DriverContext {
		return {};
	}

	async readPersistedData(actorId: string): Promise<Uint8Array | undefined> {
		const handler = this.#actors.get(actorId);
		if (!handler) throw new Error(`Actor ${actorId} not loaded`);
		if (handler.persistedData) return handler.persistedData;

		const [value] = await this.#runner.kvGet(actorId, [KEYS.PERSIST_DATA]);

		if (value !== null) {
			handler.persistedData = value;
			return value;
		} else {
			return undefined;
		}
	}

	async writePersistedData(actorId: string, data: Uint8Array): Promise<void> {
		const handler = this.#actors.get(actorId);
		if (!handler) throw new Error(`Actor ${actorId} not loaded`);

		handler.persistedData = data;

		await this.#runner.kvPut(actorId, [[KEYS.PERSIST_DATA, data]]);
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		// Clear prev timeout
		if (this.#alarmTimeout) {
			this.#alarmTimeout.abort();
			this.#alarmTimeout = undefined;
		}

		// Set alarm
		const delay = Math.max(0, timestamp - Date.now());
		this.#alarmTimeout = setLongTimeout(() => {
			actor._onAlarm();
			this.#alarmTimeout = undefined;
		}, delay);

		// TODO: This call may not be needed on ActorInstance.start, but it does help ensure that the local state is synced with the alarm state
		// Set alarm on Rivet
		//
		// This does not call an "alarm" event like Durable Objects.
		// Instead, it just wakes the actor on the alarm (if not
		// already awake).
		//
		// _onAlarm is automatically called on `ActorInstance.start` when waking
		// again.
		this.#runner.setAlarm(actor.id, timestamp);
	}

	async getDatabase(_actorId: string): Promise<unknown | undefined> {
		return undefined;
	}

	// Runner lifecycle callbacks
	async #runnerOnActorStart(
		actorId: string,
		generation: number,
		config: RunnerActorConfig,
	): Promise<void> {
		logger().debug({
			msg: "runner actor starting",
			actorId,
			name: config.name,
			key: config.key,
			generation,
		});

		// Deserialize input
		let input: any;
		if (config.input) {
			input = cbor.decode(config.input);
		}

		// Get or create handler
		let handler = this.#actors.get(actorId);
		if (!handler) {
			handler = {
				actorStartPromise: promiseWithResolvers(),
				persistedData: serializeEmptyPersistData(input),
			};
			this.#actors.set(actorId, handler);
		}

		const name = config.name as string;
		invariant(config.key, "actor should have a key");
		const key = deserializeActorKey(config.key);

		// Create actor instance
		const definition = lookupInRegistry(
			this.#registryConfig,
			config.name as string, // TODO: Remove cast
		);
		handler.actor = definition.instantiate();

		// Start actor
		await handler.actor.start(
			this,
			this.#inlineClient,
			actorId,
			name,
			key,
			"unknown", // TODO: Add regions
		);

		// Resolve promise if waiting
		handler.actorStartPromise?.resolve();
		handler.actorStartPromise = undefined;

		logger().debug({ msg: "runner actor started", actorId, name, key });
	}

	async #runnerOnActorStop(actorId: string, generation: number): Promise<void> {
		logger().debug({ msg: "runner actor stopping", actorId, generation });

		const handler = this.#actors.get(actorId);
		if (handler?.actor) {
			await handler.actor._stop();
			this.#actors.delete(actorId);
		}

		logger().debug({ msg: "runner actor stopped", actorId });
	}

	async #runnerFetch(actorId: string, request: Request): Promise<Response> {
		logger().debug({
			msg: "runner fetch",
			actorId,
			url: request.url,
			method: request.method,
		});
		return await this.#actorRouter.fetch(request, { actorId });
	}

	async #runnerWebSocket(
		actorId: string,
		websocketRaw: any,
		request: Request,
	): Promise<void> {
		const websocket = websocketRaw as UniversalWebSocket;

		logger().debug({ msg: "runner websocket", actorId, url: request.url });

		const url = new URL(request.url);

		// Parse configuration from Sec-WebSocket-Protocol header
		const protocols = request.headers.get("sec-websocket-protocol");
		if (protocols === null)
			throw new Error(`Missing sec-websocket-protocol header`);

		let encodingRaw: string | undefined;
		let connParamsRaw: string | undefined;

		if (protocols) {
			const protocolList = protocols.split(",").map((p) => p.trim());
			for (const protocol of protocolList) {
				if (protocol.startsWith(WS_PROTOCOL_ENCODING)) {
					encodingRaw = protocol.substring(WS_PROTOCOL_ENCODING.length);
				} else if (protocol.startsWith(WS_PROTOCOL_CONN_PARAMS)) {
					connParamsRaw = decodeURIComponent(
						protocol.substring(WS_PROTOCOL_CONN_PARAMS.length),
					);
				}
			}
		}

		const encoding = EncodingSchema.parse(encodingRaw);
		const connParams = connParamsRaw ? JSON.parse(connParamsRaw) : undefined;

		// Fetch WS handler
		//
		// We store the promise since we need to add WebSocket event listeners immediately that will wait for the promise to resolve
		let wsHandlerPromise: Promise<UpgradeWebSocketArgs>;
		if (url.pathname === PATH_CONNECT_WEBSOCKET) {
			wsHandlerPromise = handleWebSocketConnect(
				request,
				this.#runConfig,
				this,
				actorId,
				encoding,
				connParams,
				// Extract connId and connToken from protocols if needed
				undefined,
				undefined,
			);
		} else if (url.pathname.startsWith(PATH_RAW_WEBSOCKET_PREFIX)) {
			wsHandlerPromise = handleRawWebSocketHandler(
				request,
				url.pathname + url.search,
				this,
				actorId,
			);
		} else {
			throw new Error(`Unreachable path: ${url.pathname}`);
		}

		// TODO: Add close

		// Connect the Hono WS hook to the adapter
		const wsContext = new WSContext(websocket);

		wsHandlerPromise.catch((err) => {
			logger().error({ msg: "building websocket handlers errored", err });
			wsContext.close(1011, `${err}`);
		});

		if (websocket.readyState === 1) {
			wsHandlerPromise.then((x) => x.onOpen?.(new Event("open"), wsContext));
		} else {
			websocket.addEventListener("open", (event) => {
				wsHandlerPromise.then((x) => x.onOpen?.(event, wsContext));
			});
		}

		websocket.addEventListener("message", (event) => {
			wsHandlerPromise.then((x) => x.onMessage?.(event, wsContext));
		});

		websocket.addEventListener("close", (event) => {
			wsHandlerPromise.then((x) => x.onClose?.(event, wsContext));
		});

		websocket.addEventListener("error", (event) => {
			wsHandlerPromise.then((x) => x.onError?.(event, wsContext));
		});
	}

	async sleep(actorId: string) {
		this.#runner.sleepActor(actorId);
	}

	async shutdown(immediate: boolean): Promise<void> {
		logger().info({ msg: "stopping engine actor driver" });
		await this.#runner.shutdown(immediate);
	}

	async serverlessHandleStart(c: HonoContext): Promise<Response> {
		await this.#runnerStarted.promise;

		return streamSSE(c, async (stream) => {
			// Runner id should be set if the runner started
			const payload = this.#runner.getServerlessInitPacket();
			invariant(payload, "runnerId not set");
			stream.writeSSE({ data: payload });

			return this.#runnerStopped.promise;
		});
	}
}
