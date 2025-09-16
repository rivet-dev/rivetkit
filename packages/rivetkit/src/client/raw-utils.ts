import invariant from "invariant";
import { PATH_RAW_WEBSOCKET_PREFIX } from "@/actor/router";
import { deconstructError } from "@/common/utils";
import { HEADER_CONN_PARAMS, type ManagerDriver } from "@/driver-helpers/mod";
import type { ActorQuery } from "@/manager/protocol/query";
import { queryActor } from "./actor-query";
import { ActorError } from "./errors";
import { logger } from "./log";

/**
 * Shared implementation for raw HTTP fetch requests
 */
export async function rawHttpFetch(
	driver: ManagerDriver,
	actorQuery: ActorQuery,
	params: unknown,
	input: string | URL | Request,
	init?: RequestInit,
): Promise<Response> {
	// Extract path and merge init options
	let path: string;
	let mergedInit: RequestInit = init || {};

	if (typeof input === "string") {
		path = input;
	} else if (input instanceof URL) {
		path = input.pathname + input.search;
	} else if (input instanceof Request) {
		// Extract path from Request URL
		const url = new URL(input.url);
		path = url.pathname + url.search;
		// Merge Request properties with init
		const requestHeaders = new Headers(input.headers);
		const initHeaders = new Headers(init?.headers || {});

		// Merge headers - init headers override request headers
		const mergedHeaders = new Headers(requestHeaders);
		for (const [key, value] of initHeaders) {
			mergedHeaders.set(key, value);
		}

		mergedInit = {
			method: input.method,
			body: input.body,
			mode: input.mode,
			credentials: input.credentials,
			redirect: input.redirect,
			referrer: input.referrer,
			referrerPolicy: input.referrerPolicy,
			integrity: input.integrity,
			keepalive: input.keepalive,
			signal: input.signal,
			...mergedInit, // init overrides Request properties
			headers: mergedHeaders, // headers must be set after spread to ensure proper merge
		};
		// Add duplex if body is present
		if (mergedInit.body) {
			(mergedInit as any).duplex = "half";
		}
	} else {
		throw new TypeError("Invalid input type for fetch");
	}

	try {
		// Get the actor ID
		const { actorId } = await queryActor(undefined, actorQuery, driver);
		logger().debug({ msg: "found actor for raw http", actorId });
		invariant(actorId, "Missing actor ID");

		// Build the URL with normalized path
		const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
		const url = new URL(`http://actor/raw/http/${normalizedPath}`);

		// Forward conn params if provided
		const proxyRequestHeaders = new Headers(mergedInit.headers);
		if (params) {
			proxyRequestHeaders.set(HEADER_CONN_PARAMS, JSON.stringify(params));
		}

		// Forward the request to the actor
		const proxyRequest = new Request(url, {
			...init,
			headers: proxyRequestHeaders,
		});

		return driver.sendRequest(actorId, proxyRequest);
	} catch (err) {
		// Standardize to ClientActorError instead of the native backend error
		const { group, code, message, metadata } = deconstructError(
			err,
			logger(),
			{},
			true,
		);
		throw new ActorError(group, code, message, metadata);
	}
}

/**
 * Shared implementation for raw WebSocket connections
 */
export async function rawWebSocket(
	driver: ManagerDriver,
	actorQuery: ActorQuery,
	params: unknown,
	path?: string,
	// TODO: Supportp rotocols
	protocols?: string | string[],
): Promise<any> {
	// TODO: Do we need encoding in rawWebSocket?
	const encoding = "bare";

	// Get the actor ID
	const { actorId } = await queryActor(undefined, actorQuery, driver);
	logger().debug({ msg: "found actor for action", actorId });
	invariant(actorId, "Missing actor ID");

	// Normalize path to match raw HTTP behavior
	const normalizedPath = path
		? path.startsWith("/")
			? path.slice(1)
			: path
		: "";
	logger().debug({
		msg: "opening websocket",
		actorId,
		encoding,
		path: normalizedPath,
	});

	// Open WebSocket
	const ws = await driver.openWebSocket(
		`${PATH_RAW_WEBSOCKET_PREFIX}${normalizedPath}`,
		actorId,
		encoding,
		params,
	);

	// Node & browser WebSocket types are incompatible
	return ws as any;
}
