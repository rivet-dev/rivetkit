import * as cbor from "cbor-x";
import type { Context as HonoContext } from "hono";
import invariant from "invariant";
import { deserializeActorKey, serializeActorKey } from "@/actor/keys";
import type { ClientConfig } from "@/client/client";
import { noopNext } from "@/common/utils";
import type {
	ActorOutput,
	CreateInput,
	GetForIdInput,
	GetOrCreateWithKeyInput,
	GetWithKeyInput,
	ManagerDisplayInformation,
	ManagerDriver,
} from "@/driver-helpers/mod";
import type { Encoding, UniversalWebSocket } from "@/mod";
import { combineUrlPath } from "@/utils";
import { sendHttpRequestToActor } from "./actor-http-client";
import {
	buildGuardHeadersForWebSocket,
	openWebSocketToActor,
} from "./actor-websocket-client";
import {
	createActor,
	destroyActor,
	getActor,
	getActorByKey,
	getOrCreateActor,
} from "./api-endpoints";
import { EngineApiError, getEndpoint } from "./api-utils";
import { logger } from "./log";
import { createWebSocketProxy } from "./ws-proxy";

// TODO:
// // Lazily import the dynamic imports so we don't have to turn `createClient` in to an async fn
// const dynamicImports = (async () => {
// 	// Import dynamic dependencies
// 	const [WebSocket, EventSource] = await Promise.all([
// 		importWebSocket(),
// 		importEventSource(),
// 	]);
// 	return {
// 		WebSocket,
// 		EventSource,
// 	};
// })();

export class RemoteManagerDriver implements ManagerDriver {
	#config: ClientConfig;

	constructor(runConfig: ClientConfig) {
		this.#config = runConfig;
	}

	async getForId({
		c,
		name,
		actorId,
	}: GetForIdInput): Promise<ActorOutput | undefined> {
		// Fetch from API if not in cache
		const response = await getActor(this.#config, name, actorId);
		const actor = response.actors[0];
		if (!actor) return undefined;

		// Validate name matches
		if (actor.name !== name) {
			logger().debug({
				msg: "actor name mismatch from api",
				actorId,
				apiName: actor.name,
				requestedName: name,
			});
			return undefined;
		}

		const keyRaw = actor.key;
		invariant(keyRaw, `actor ${actorId} should have key`);
		const key = deserializeActorKey(keyRaw);

		return {
			actorId,
			name,
			key,
		};
	}

	async getWithKey({
		c,
		name,
		key,
	}: GetWithKeyInput): Promise<ActorOutput | undefined> {
		logger().debug({ msg: "getWithKey: searching for actor", name, key });

		// If not in local cache, fetch by key from API
		try {
			const response = await getActorByKey(this.#config, name, key);
			const actor = response.actors[0];
			if (!actor) return undefined;

			const actorId = actor.actor_id;

			logger().debug({
				msg: "getWithKey: found actor via api",
				actorId,
				name,
				key,
			});

			return {
				actorId,
				name,
				key,
			};
		} catch (error) {
			if (
				error instanceof EngineApiError &&
				(error as EngineApiError).group === "actor" &&
				(error as EngineApiError).code === "not_found"
			) {
				return undefined;
			}
			throw error;
		}
	}

	async getOrCreateWithKey(
		input: GetOrCreateWithKeyInput,
	): Promise<ActorOutput> {
		const { c, name, key, input: actorInput, region } = input;

		logger().info({
			msg: "getOrCreateWithKey: getting or creating actor via engine api",
			name,
			key,
		});

		const { actor, created } = await getOrCreateActor(this.#config, {
			name,
			key: serializeActorKey(key),
			runner_name_selector: this.#config.runnerName,
			input: input ? cbor.encode(actorInput).toString("base64") : undefined,
			crash_policy: "sleep",
		});

		const actorId = actor.actor_id;

		logger().info({
			msg: "getOrCreateWithKey: actor ready",
			actorId,
			name,
			key,
			created,
		});

		return {
			actorId,
			name,
			key,
		};
	}

	async createActor({
		c,
		name,
		key,
		input,
	}: CreateInput): Promise<ActorOutput> {
		logger().info({ msg: "creating actor via engine api", name, key });

		// Create actor via engine API
		const result = await createActor(this.#config, {
			name,
			runner_name_selector: this.#config.runnerName,
			key: serializeActorKey(key),
			input: input ? cbor.encode(input).toString("base64") : null,
			crash_policy: "sleep",
		});
		const actorId = result.actor.actor_id;

		logger().info({ msg: "actor created", actorId, name, key });

		return {
			actorId,
			name,
			key,
		};
	}

	async destroyActor(actorId: string): Promise<void> {
		logger().info({ msg: "destroying actor via engine api", actorId });

		await destroyActor(this.#config, actorId);

		logger().info({ msg: "actor destroyed", actorId });
	}

	async sendRequest(actorId: string, actorRequest: Request): Promise<Response> {
		return await sendHttpRequestToActor(this.#config, actorId, actorRequest);
	}

	async openWebSocket(
		path: string,
		actorId: string,
		encoding: Encoding,
		params: unknown,
	): Promise<UniversalWebSocket> {
		return await openWebSocketToActor(
			this.#config,
			path,
			actorId,
			encoding,
			params,
		);
	}

	async proxyRequest(
		_c: HonoContext,
		actorRequest: Request,
		actorId: string,
	): Promise<Response> {
		return await sendHttpRequestToActor(this.#config, actorId, actorRequest);
	}

	async proxyWebSocket(
		c: HonoContext,
		path: string,
		actorId: string,
		encoding: Encoding,
		params: unknown,
		authData: unknown,
	): Promise<Response> {
		const upgradeWebSocket = this.#config.getUpgradeWebSocket?.();
		invariant(upgradeWebSocket, "missing getUpgradeWebSocket");

		const endpoint = getEndpoint(this.#config);
		const guardUrl = combineUrlPath(endpoint, path);
		const wsGuardUrl = guardUrl.replace("http://", "ws://");

		logger().debug({
			msg: "forwarding websocket to actor via guard",
			actorId,
			path,
			guardUrl,
		});

		// Build headers
		const headers = buildGuardHeadersForWebSocket(
			actorId,
			encoding,
			params,
			authData,
		);
		const args = await createWebSocketProxy(c, wsGuardUrl, headers);

		return await upgradeWebSocket(() => args)(c, noopNext());
	}

	displayInformation(): ManagerDisplayInformation {
		return { name: "Remote", properties: {} };
	}
}
