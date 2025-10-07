import type { ClientConfig } from "@/client/config";
import { sendHttpRequest } from "@/client/utils";
import { combineUrlPath } from "@/utils";
import { logger } from "./log";

// Error class for Engine API errors
export class EngineApiError extends Error {
	constructor(
		public readonly group: string,
		public readonly code: string,
		message?: string,
	) {
		super(message || `Engine API error: ${group}/${code}`);
		this.name = "EngineApiError";
	}
}

export function getEndpoint(config: ClientConfig) {
	return config.endpoint ?? "http://127.0.0.1:6420";
}

// Helper function for making API calls
export async function apiCall<TInput = unknown, TOutput = unknown>(
	config: ClientConfig,
	method: "GET" | "POST" | "PUT" | "DELETE",
	path: string,
	body?: TInput,
): Promise<TOutput> {
	const endpoint = getEndpoint(config);
	const url = combineUrlPath(endpoint, path, {
		namespace: config.namespace,
	});

	logger().debug({ msg: "making api call", method, url });

	const headers: Record<string, string> = {
		...config.headers,
	};

	// Add Authorization header if token is provided
	if (config.token) {
		headers.Authorization = `Bearer ${config.token}`;
	}

	return await sendHttpRequest<TInput, TOutput>({
		method,
		url,
		headers,
		body,
		encoding: "json",
		skipParseResponse: false,
		requestVersionedDataHandler: undefined,
		responseVersionedDataHandler: undefined,
	});
}
