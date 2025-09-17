import type { ClientConfig } from "@/client/config";
import { combineUrlPath } from "@/utils";
import { getEndpoint } from "./api-utils";

export async function sendHttpRequestToActor(
	runConfig: ClientConfig,
	actorId: string,
	actorRequest: Request,
): Promise<Response> {
	// Route through guard port
	const url = new URL(actorRequest.url);
	const endpoint = getEndpoint(runConfig);
	const guardUrl = combineUrlPath(endpoint, url.pathname + url.search);

	// Handle body properly based on method and presence
	let bodyToSend: ArrayBuffer | null = null;
	const guardHeaders = buildGuardHeadersForHttp(actorRequest, actorId);

	if (
		actorRequest.body &&
		actorRequest.method !== "GET" &&
		actorRequest.method !== "HEAD"
	) {
		if (actorRequest.bodyUsed) {
			throw new Error("Request body has already been consumed");
		}

		// TODO: This buffers the entire request in memory every time. We
		// need to properly implement streaming bodies.
		// Clone and read the body to ensure it can be sent
		const clonedRequest = actorRequest.clone();
		bodyToSend = await clonedRequest.arrayBuffer();

		// If this is a streaming request, we need to convert the headers
		// for the basic array buffer
		guardHeaders.delete("transfer-encoding");
		guardHeaders.set(
			"content-length",
			String((bodyToSend as ArrayBuffer).byteLength),
		);
	}

	const guardRequest = new Request(guardUrl, {
		method: actorRequest.method,
		headers: guardHeaders,
		body: bodyToSend,
		signal: actorRequest.signal,
	});

	return mutableResponse(await fetch(guardRequest));
}

function mutableResponse(fetchRes: Response): Response {
	// We cannot return the raw response from `fetch` since the response type is not mutable.
	//
	// In order for middleware to be able to mutate the response, we need to build a new Response object that is mutable.
	return new Response(fetchRes.body, fetchRes);
}

function buildGuardHeadersForHttp(
	actorRequest: Request,
	actorId: string,
): Headers {
	const headers = new Headers();
	// Copy all headers from the original request
	for (const [key, value] of actorRequest.headers.entries()) {
		headers.set(key, value);
	}
	// Add guard-specific headers
	headers.set("x-rivet-target", "actor");
	headers.set("x-rivet-actor", actorId);
	headers.set("x-rivet-port", "main");
	return headers;
}
