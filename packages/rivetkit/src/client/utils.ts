import * as cbor from "cbor-x";
import invariant from "invariant";
import { assertUnreachable } from "@/common/utils";
import type { VersionedDataHandler } from "@/common/versioned-data";
import type { Encoding } from "@/mod";
import type { HttpResponseError } from "@/schemas/client-protocol/mod";
import { HTTP_RESPONSE_ERROR_VERSIONED } from "@/schemas/client-protocol/versioned";
import {
	contentTypeForEncoding,
	deserializeWithEncoding,
	serializeWithEncoding,
} from "@/serde";
import { httpUserAgent } from "@/utils";
import { ActorError, HttpRequestError } from "./errors";
import { logger } from "./log";

export type WebSocketMessage = string | Blob | ArrayBuffer | Uint8Array;

export function messageLength(message: WebSocketMessage): number {
	if (message instanceof Blob) {
		return message.size;
	}
	if (message instanceof ArrayBuffer) {
		return message.byteLength;
	}
	if (message instanceof Uint8Array) {
		return message.byteLength;
	}
	if (typeof message === "string") {
		return message.length;
	}
	assertUnreachable(message);
}

export interface HttpRequestOpts<RequestBody, ResponseBody> {
	method: string;
	url: string;
	headers: Record<string, string>;
	body?: RequestBody;
	encoding: Encoding;
	skipParseResponse?: boolean;
	signal?: AbortSignal;
	customFetch?: (req: Request) => Promise<Response>;
	requestVersionedDataHandler: VersionedDataHandler<RequestBody>;
	responseVersionedDataHandler: VersionedDataHandler<ResponseBody>;
}

export async function sendHttpRequest<
	RequestBody = unknown,
	ResponseBody = unknown,
>(opts: HttpRequestOpts<RequestBody, ResponseBody>): Promise<ResponseBody> {
	logger().debug("sending http request", {
		url: opts.url,
		encoding: opts.encoding,
	});

	// Serialize body
	let contentType: string | undefined;
	let bodyData: string | Uint8Array | undefined;
	if (opts.method === "POST" || opts.method === "PUT") {
		invariant(opts.body !== undefined, "missing body");
		contentType = contentTypeForEncoding(opts.encoding);
		bodyData = serializeWithEncoding<RequestBody>(
			opts.encoding,
			opts.body,
			opts.requestVersionedDataHandler,
		);
	}

	// Send request
	let response: Response;
	try {
		// Make the HTTP request
		response = await (opts.customFetch ?? fetch)(
			new Request(opts.url, {
				method: opts.method,
				headers: {
					...opts.headers,
					...(contentType
						? {
								"Content-Type": contentType,
							}
						: {}),
					"User-Agent": httpUserAgent(),
				},
				body: bodyData,
				credentials: "include",
				signal: opts.signal,
			}),
		);
	} catch (error) {
		throw new HttpRequestError(`Request failed: ${error}`, {
			cause: error,
		});
	}

	// Parse response error
	if (!response.ok) {
		// Attempt to parse structured data
		const bufferResponse = await response.arrayBuffer();
		let responseData: HttpResponseError;
		try {
			responseData = deserializeWithEncoding(
				opts.encoding,
				new Uint8Array(bufferResponse),
				HTTP_RESPONSE_ERROR_VERSIONED,
			);
		} catch (error) {
			//logger().warn("failed to cleanly parse error, this is likely because a non-structured response is being served", {
			//	error: stringifyError(error),
			//});

			// Error is not structured
			const textResponse = new TextDecoder("utf-8", { fatal: false }).decode(
				bufferResponse,
			);
			throw new HttpRequestError(
				`${response.statusText} (${response.status}):\n${textResponse}`,
			);
		}

		// Throw structured error
		throw new ActorError(
			responseData.code,
			responseData.message,
			responseData.metadata
				? cbor.decode(new Uint8Array(responseData.metadata))
				: undefined,
		);
	}

	// Some requests don't need the success response to be parsed, so this can speed things up
	if (opts.skipParseResponse) {
		return undefined as ResponseBody;
	}

	// Parse the response based on encoding
	try {
		const buffer = new Uint8Array(await response.arrayBuffer());
		return deserializeWithEncoding(
			opts.encoding,
			buffer,
			opts.responseVersionedDataHandler,
		);
	} catch (error) {
		throw new HttpRequestError(`Failed to parse response: ${error}`, {
			cause: error,
		});
	}
}
