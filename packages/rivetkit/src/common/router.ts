import * as cbor from "cbor-x";
import type { Context as HonoContext, Next } from "hono";
import type { Encoding } from "@/actor/protocol/serde";
import {
	getRequestEncoding,
	getRequestExposeInternalError,
} from "@/actor/router-endpoints";
import { buildActorNames, type RegistryConfig } from "@/registry/config";
import type { RunnerConfig } from "@/registry/run-config";
import { getEndpoint } from "@/remote-manager-driver/api-utils";
import { HttpResponseError } from "@/schemas/client-protocol/mod";
import { HTTP_RESPONSE_ERROR_VERSIONED } from "@/schemas/client-protocol/versioned";
import { encodingIsBinary, serializeWithEncoding } from "@/serde";
import { bufferToArrayBuffer, getEnvUniversal, VERSION } from "@/utils";
import { getLogger, type Logger } from "./log";
import { deconstructError, stringifyError } from "./utils";

export function logger() {
	return getLogger("router");
}

export function loggerMiddleware(logger: Logger) {
	return async (c: HonoContext, next: Next) => {
		const method = c.req.method;
		const path = c.req.path;
		const startTime = Date.now();

		await next();

		const duration = Date.now() - startTime;
		logger.debug({
			msg: "http request",
			method,
			path,
			status: c.res.status,
			dt: `${duration}ms`,
			reqSize: c.req.header("content-length"),
			resSize: c.res.headers.get("content-length"),
			userAgent: c.req.header("user-agent"),
			...(getEnvUniversal("_RIVET_LOG_HEADERS")
				? { allHeaders: JSON.stringify(c.req.header()) }
				: {}),
		});
	};
}

export function handleRouteNotFound(c: HonoContext) {
	return c.text("Not Found (RivetKit)", 404);
}

export function handleRouteError(error: unknown, c: HonoContext) {
	const exposeInternalError = getRequestExposeInternalError(c.req.raw);

	const { statusCode, group, code, message, metadata } = deconstructError(
		error,
		logger(),
		{
			method: c.req.method,
			path: c.req.path,
		},
		exposeInternalError,
	);

	let encoding: Encoding;
	try {
		encoding = getRequestEncoding(c.req);
	} catch (_) {
		encoding = "json";
	}

	const output = serializeWithEncoding(
		encoding,
		{
			group,
			code,
			message,
			// TODO: Cannot serialize non-binary meta since it requires ArrayBuffer atm
			metadata: encodingIsBinary(encoding)
				? bufferToArrayBuffer(cbor.encode(metadata))
				: null,
		},
		HTTP_RESPONSE_ERROR_VERSIONED,
	);

	// TODO: Remove any
	return c.body(output as any, { status: statusCode });
}

/**
 * Metadata response interface for the /metadata endpoint
 */
export interface MetadataResponse {
	runtime: string;
	version: string;
	runner?: {
		kind:
			| { serverless: Record<never, never> }
			| { normal: Record<never, never> };
	};
	actorNames: ReturnType<typeof buildActorNames>;
	/**
	 * Endpoint that the client should connect to to access this runner.
	 *
	 * If defined, will override the endpoint the user has configured on startup.
	 *
	 * This is helpful if attempting to connect to a serverless runner, so the serverless runner can define where the main endpoint lives.
	 *
	 * This is also helpful for setting up clean redirects as needed.
	 **/
	clientEndpoint?: string;
}

export function handleMetadataRequest(
	c: HonoContext,
	registryConfig: RegistryConfig,
	runConfig: RunnerConfig,
) {
	const response: MetadataResponse = {
		runtime: "rivetkit",
		version: VERSION,
		runner: {
			kind:
				runConfig.runnerKind === "serverless"
					? { serverless: {} }
					: { normal: {} },
		},
		actorNames: buildActorNames(registryConfig),
		// Do not return client endpoint if default server disabled
		clientEndpoint:
			runConfig.overrideServerAddress ??
			(runConfig.disableDefaultServer ? undefined : getEndpoint(runConfig)),
	};

	return c.json(response);
}

export function handleHealthRequest(c: HonoContext) {
	return c.json({
		status: "ok",
		runtime: "rivetkit",
		version: VERSION,
	});
}
