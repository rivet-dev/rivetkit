import type * as wsToClient from "@/actor/protocol/message/to-client";
import * as wsToServer from "@/actor/protocol/message/to-server";
import {
	CachedSerializer,
	type Encoding,
	type InputData,
	deserialize,
} from "@/actor/protocol/serde";
import { deconstructError } from "@/common/utils";
import { z } from "zod";
import { ActionContext } from "../../action";
import type { Conn } from "../../connection";
import * as errors from "../../errors";
import type { ActorInstance } from "../../instance";
import { logger } from "../../log";
import { assertUnreachable } from "../../utils";

export const TransportSchema = z.enum(["websocket", "sse"]);

/**
 * Transport mechanism used to communicate between client & actor.
 */
export type Transport = z.infer<typeof TransportSchema>;

interface MessageEventOpts {
	encoding: Encoding;
	maxIncomingMessageSize: number;
}

function getValueLength(value: InputData): number {
	if (typeof value === "string") {
		return value.length;
	} else if (value instanceof Blob) {
		return value.size;
	} else if (
		value instanceof ArrayBuffer ||
		value instanceof SharedArrayBuffer ||
		value instanceof Uint8Array
	) {
		return value.byteLength;
	} else {
		assertUnreachable(value);
	}
}

export async function parseMessage(
	value: InputData,
	opts: MessageEventOpts,
): Promise<wsToServer.ToServer> {
	// Validate value length
	const length = getValueLength(value);
	if (length > opts.maxIncomingMessageSize) {
		throw new errors.MessageTooLong();
	}

	// Parse & validate message
	const deserializedValue = await deserialize(value, opts.encoding);
	const {
		data: message,
		success,
		error,
	} = wsToServer.ToServerSchema.safeParse(deserializedValue);
	if (!success) {
		throw new errors.MalformedMessage(error);
	}

	return message;
}

export interface ProcessMessageHandler<S, CP, CS, V, I, AD, DB> {
	onExecuteAction?: (
		ctx: ActionContext<S, CP, CS, V, I, AD, DB>,
		name: string,
		args: unknown[],
	) => Promise<unknown>;
	onSubscribe?: (
		eventName: string,
		conn: Conn<S, CP, CS, V, I, AD, DB>,
	) => Promise<void>;
	onUnsubscribe?: (
		eventName: string,
		conn: Conn<S, CP, CS, V, I, AD, DB>,
	) => Promise<void>;
}

export async function processMessage<S, CP, CS, V, I, AD, DB>(
	message: wsToServer.ToServer,
	actor: ActorInstance<S, CP, CS, V, I, AD, DB>,
	conn: Conn<S, CP, CS, V, I, AD, DB>,
	handler: ProcessMessageHandler<S, CP, CS, V, I, AD, DB>,
) {
	let actionId: number | undefined;
	let actionName: string | undefined;

	try {
		if ("ar" in message.b) {
			// Action request

			if (handler.onExecuteAction === undefined) {
				throw new errors.Unsupported("Action");
			}

			const { i: id, n: name, a: args = [] } = message.b.ar;

			actionId = id;
			actionName = name;

			logger().debug("processing action request", {
				id,
				name,
				argsCount: args.length,
			});

			const ctx = new ActionContext<S, CP, CS, V, I, AD, DB>(
				actor.actorContext,
				conn,
			);

			// Process the action request and wait for the result
			// This will wait for async actions to complete
			const output = await handler.onExecuteAction(ctx, name, args);

			logger().debug("sending action response", {
				id,
				name,
				outputType: typeof output,
				isPromise: output instanceof Promise,
			});

			// Send the response back to the client
			conn._sendMessage(
				new CachedSerializer<wsToClient.ToClient>({
					b: {
						ar: {
							i: id,
							o: output,
						},
					},
				}),
			);

			logger().debug("action response sent", { id, name });
		} else if ("sr" in message.b) {
			// Subscription request

			if (
				handler.onSubscribe === undefined ||
				handler.onUnsubscribe === undefined
			) {
				throw new errors.Unsupported("Subscriptions");
			}

			const { e: eventName, s: subscribe } = message.b.sr;
			logger().debug("processing subscription request", {
				eventName,
				subscribe,
			});

			if (subscribe) {
				await handler.onSubscribe(eventName, conn);
			} else {
				await handler.onUnsubscribe(eventName, conn);
			}

			logger().debug("subscription request completed", {
				eventName,
				subscribe,
			});
		} else {
			assertUnreachable(message.b);
		}
	} catch (error) {
		const { code, message, metadata } = deconstructError(error, logger(), {
			connectionId: conn.id,
			actionId,
			actionName,
		});

		logger().debug("sending error response", {
			actionId,
			actionName,
			code,
			message,
		});

		// Build response
		conn._sendMessage(
			new CachedSerializer<wsToClient.ToClient>({
				b: {
					e: {
						c: code,
						m: message,
						md: metadata,
						ai: actionId,
					},
				},
			}),
		);

		logger().debug("error response sent", { actionId, actionName });
	}
}
