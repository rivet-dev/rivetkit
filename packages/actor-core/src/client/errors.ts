import { MAX_CONN_PARAMS_SIZE } from "@/common//network";

export class ActorClientError extends Error {}

export class InternalError extends ActorClientError {}

export class ManagerError extends ActorClientError {
	constructor(error: string, opts?: ErrorOptions) {
		super(`Manager error: ${error}`, opts);
	}
}

export class ConnectionParametersTooLong extends ActorClientError {
	constructor() {
		super(
			`Connection parameters must be less than ${MAX_CONN_PARAMS_SIZE} bytes`,
		);
	}
}

export class MalformedResponseMessage extends ActorClientError {
	constructor(cause?: unknown) {
		super(`Malformed response message: ${cause}`, { cause });
	}
}

export class NoSupportedTransport extends ActorClientError {
	constructor() {
		super("No supported transport available between client and server");
	}
}

export class RpcError extends ActorClientError {
	constructor(
		public readonly code: string,
		message: string,
		public readonly metadata?: unknown,
	) {
		super(message);
	}
}
