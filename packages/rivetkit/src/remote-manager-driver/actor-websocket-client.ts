import type { ClientConfig } from "@/client/config";
import {
	HEADER_CONN_PARAMS,
	HEADER_ENCODING,
	WS_PROTOCOL_ACTOR,
	WS_PROTOCOL_CONN_ID,
	WS_PROTOCOL_CONN_PARAMS,
	WS_PROTOCOL_CONN_TOKEN,
	WS_PROTOCOL_ENCODING,
	WS_PROTOCOL_STANDARD as WS_PROTOCOL_RIVETKIT,
	WS_PROTOCOL_TARGET,
	WS_PROTOCOL_TOKEN,
} from "@/common/actor-router-consts";
import { importWebSocket } from "@/common/websocket";
import type { Encoding, UniversalWebSocket } from "@/mod";
import { combineUrlPath } from "@/utils";
import { getEndpoint } from "./api-utils";
import { logger } from "./log";

export async function openWebSocketToActor(
	runConfig: ClientConfig,
	path: string,
	actorId: string,
	encoding: Encoding,
	params: unknown,
	connId?: string,
	connToken?: string,
): Promise<UniversalWebSocket> {
	const WebSocket = await importWebSocket();

	// WebSocket connections go through guard
	const endpoint = getEndpoint(runConfig);
	const guardUrl = combineUrlPath(endpoint, path);

	logger().debug({
		msg: "opening websocket to actor via guard",
		actorId,
		path,
		guardUrl,
	});

	// Create WebSocket connection
	const ws = new WebSocket(
		guardUrl,
		buildWebSocketProtocols(
			runConfig,
			actorId,
			encoding,
			params,
			connId,
			connToken,
		),
	);

	// Set binary type to arraybuffer for proper encoding support
	ws.binaryType = "arraybuffer";

	logger().debug({ msg: "websocket connection opened", actorId });

	return ws as UniversalWebSocket;
}

export function buildWebSocketProtocols(
	runConfig: ClientConfig,
	actorId: string,
	encoding: Encoding,
	params?: unknown,
	connId?: string,
	connToken?: string,
): string[] {
	const protocols: string[] = [];
	protocols.push(WS_PROTOCOL_RIVETKIT);
	protocols.push(`${WS_PROTOCOL_TARGET}actor`);
	protocols.push(`${WS_PROTOCOL_ACTOR}${actorId}`);
	protocols.push(`${WS_PROTOCOL_ENCODING}${encoding}`);
	if (runConfig.token) {
		protocols.push(`${WS_PROTOCOL_TOKEN}${runConfig.token}`);
	}
	if (params) {
		protocols.push(
			`${WS_PROTOCOL_CONN_PARAMS}${encodeURIComponent(JSON.stringify(params))}`,
		);
	}
	if (connId) {
		protocols.push(`${WS_PROTOCOL_CONN_ID}${connId}`);
	}
	if (connToken) {
		protocols.push(`${WS_PROTOCOL_CONN_TOKEN}${connToken}`);
	}
	return protocols;
}
