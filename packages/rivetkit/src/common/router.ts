import * as cbor from "cbor-x";
import type { Context as HonoContext, Next } from "hono";
import type { Encoding } from "@/actor/protocol/serde";
import {
	getRequestEncoding,
	getRequestExposeInternalError,
} from "@/actor/router-endpoints";
import { HttpResponseError } from "@/schemas/client-protocol/mod";
import { HTTP_RESPONSE_ERROR_VERSIONED } from "@/schemas/client-protocol/versioned";
import { encodingIsBinary, serializeWithEncoding } from "@/serde";
import { bufferToArrayBuffer } from "@/utils";
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
