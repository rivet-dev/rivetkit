import {
	HEADER_AUTH_DATA,
	HEADER_CONN_PARAMS,
	HEADER_ENCODING,
} from "@/actor/router-endpoints";
import type { ClientConfig } from "@/client/config";
import { importWebSocket } from "@/common/websocket";
import type { Encoding, UniversalWebSocket } from "@/mod";
import { getEndpoint } from "./api-utils";
import { logger } from "./log";

export async function openWebSocketToActor(
	runConfig: ClientConfig,
	path: string,
	actorId: string,
	encoding: Encoding,
	params: unknown,
): Promise<UniversalWebSocket> {
	const WebSocket = await importWebSocket();

	// WebSocket connections go through guard
	const endpoint = getEndpoint(runConfig);
	const guardUrl = `${endpoint}${path}`;

	logger().debug({
		msg: "opening websocket to actor via guard",
		actorId,
		path,
		guardUrl,
	});

	// Create WebSocket connection
	const ws = new WebSocket(guardUrl, {
		headers: buildGuardHeadersForWebSocket(actorId, encoding, params),
	});

	logger().debug({ msg: "websocket connection opened", actorId });

	return ws as UniversalWebSocket;
}

export function buildGuardHeadersForWebSocket(
	actorId: string,
	encoding: Encoding,
	params?: unknown,
	authData?: unknown,
): Record<string, string> {
	const headers: Record<string, string> = {};
	headers["x-rivet-target"] = "actor";
	headers["x-rivet-actor"] = actorId;
	headers["x-rivet-port"] = "main";
	headers[HEADER_ENCODING] = encoding;
	if (params) {
		headers[HEADER_CONN_PARAMS] = JSON.stringify(params);
	}
	if (authData) {
		headers[HEADER_AUTH_DATA] = JSON.stringify(authData);
	}
	return headers;
}
