import * as cbor from "cbor-x";
import type * as protocol from "@/schemas/client-protocol/mod";
import { TO_CLIENT_VERSIONED } from "@/schemas/client-protocol/versioned";
import { bufferToArrayBuffer } from "@/utils";
import {
	CONN_DRIVERS,
	ConnDriverKind,
	type ConnDriverState,
	ConnReadyState,
	getConnDriverFromState,
} from "./conn-drivers";
import type { AnyDatabaseProvider } from "./database";
import * as errors from "./errors";
import type { ActorInstance } from "./instance";
import type { PersistedConn } from "./persisted";
import { CachedSerializer } from "./protocol/serde";
import { generateSecureToken } from "./utils";

export function generateConnId(): string {
	return crypto.randomUUID();
}

export function generateConnToken(): string {
	return generateSecureToken(32);
}

export type ConnId = string;

export type AnyConn = Conn<any, any, any, any, any, any>;

export type ConnectionStatus = "connected" | "reconnecting";

export const CONNECTION_CHECK_LIVENESS_SYMBOL = Symbol("checkLiveness");

/**
 * Represents a client connection to a actor.
 *
 * Manages connection-specific data and controls the connection lifecycle.
 *
 * @see {@link https://rivet.dev/docs/connections|Connection Documentation}
 */
export class Conn<S, CP, CS, V, I, DB extends AnyDatabaseProvider> {
	subscriptions: Set<string> = new Set<string>();

	// TODO: Remove this cyclical reference
	#actor: ActorInstance<S, CP, CS, V, I, DB>;

	#status: ConnectionStatus = "connected";

	/**
	 * The proxied state that notifies of changes automatically.
	 *
	 * Any data that should be stored indefinitely should be held within this object.
	 */
	__persist: PersistedConn<CP, CS>;

	/**
	 * Driver used to manage connection. If undefined, there is no connection connected.
	 */
	__driverState?: ConnDriverState;

	public get params(): CP {
		return this.__persist.params;
	}

	public get __stateEnabled() {
		return this.#actor.connStateEnabled;
	}

	/**
	 * Gets the current state of the connection.
	 *
	 * Throws an error if the state is not enabled.
	 */
	public get state(): CS {
		this.#validateStateEnabled();
		if (!this.__persist.state) throw new Error("state should exists");
		return this.__persist.state;
	}

	/**
	 * Sets the state of the connection.
	 *
	 * Throws an error if the state is not enabled.
	 */
	public set state(value: CS) {
		this.#validateStateEnabled();
		this.__persist.state = value;
	}

	/**
	 * Unique identifier for the connection.
	 */
	public get id(): ConnId {
		return this.__persist.connId;
	}

	/**
	 * Token used to authenticate this request.
	 */
	public get _token(): string {
		return this.__persist.token;
	}

	/**
	 * Status of the connection.
	 */
	public get status(): ConnectionStatus {
		return this.#status;
	}

	/**
	 * Timestamp of the last time the connection was seen, i.e. the last time the connection was active and checked for liveness.
	 */
	public get lastSeen(): number {
		return this.__persist.lastSeen;
	}

	/**
	 * Initializes a new instance of the Connection class.
	 *
	 * This should only be constructed by {@link Actor}.
	 *
	 * @protected
	 */
	public constructor(
		actor: ActorInstance<S, CP, CS, V, I, DB>,
		persist: PersistedConn<CP, CS>,
	) {
		this.#actor = actor;
		this.__persist = persist;
	}

	#validateStateEnabled() {
		if (!this.__stateEnabled) {
			throw new errors.ConnStateNotEnabled();
		}
	}

	/**
	 * Sends a WebSocket message to the client.
	 *
	 * @param message - The message to send.
	 *
	 * @protected
	 */
	public _sendMessage(message: CachedSerializer<protocol.ToClient>) {
		if (this.__driverState) {
			const driver = getConnDriverFromState(this.__driverState);
			if (driver.sendMessage) {
				driver.sendMessage(this.#actor, this, this.__driverState, message);
			} else {
				this.#actor.rLog.debug({
					msg: "conn driver does not support sending messages",
					conn: this.id,
				});
			}
		} else {
			this.#actor.rLog.warn({
				msg: "missing connection driver state for send message",
				conn: this.id,
			});
		}
	}

	/**
	 * Sends an event with arguments to the client.
	 *
	 * @param eventName - The name of the event.
	 * @param args - The arguments for the event.
	 * @see {@link https://rivet.dev/docs/events|Events Documentation}
	 */
	public send(eventName: string, ...args: unknown[]) {
		this.#actor.inspector.emitter.emit("eventFired", {
			type: "event",
			eventName,
			args,
			connId: this.id,
		});
		this._sendMessage(
			new CachedSerializer<protocol.ToClient>(
				{
					body: {
						tag: "Event",
						val: {
							name: eventName,
							args: bufferToArrayBuffer(cbor.encode(args)),
						},
					},
				},
				TO_CLIENT_VERSIONED,
			),
		);
	}

	/**
	 * Disconnects the client with an optional reason.
	 *
	 * @param reason - The reason for disconnection.
	 */
	public async disconnect(reason?: string) {
		this.#status = "reconnecting";

		if (this.__driverState) {
			const driver = getConnDriverFromState(this.__driverState);
			if (driver.disconnect) {
				driver.disconnect(this.#actor, this, this.__driverState, reason);
			} else {
				this.#actor.rLog.debug({
					msg: "no disconnect handler for conn driver",
					conn: this.id,
				});
			}
		} else {
			this.#actor.rLog.warn({
				msg: "missing connection driver state for disconnect",
				conn: this.id,
			});
		}
	}

	/**
	 * This method checks the connection's liveness by querying the driver for its ready state.
	 * If the connection is not closed, it updates the last liveness timestamp and returns `true`.
	 * Otherwise, it returns `false`.
	 * @internal
	 */
	[CONNECTION_CHECK_LIVENESS_SYMBOL]() {
		let readyState: ConnReadyState | undefined;

		if (this.__driverState) {
			const driver = getConnDriverFromState(this.__driverState);
			readyState = driver.getConnectionReadyState(
				this.#actor,
				this,
				this.__driverState,
			);
		}

		const isConnectionClosed =
			readyState === ConnReadyState.CLOSED ||
			readyState === ConnReadyState.CLOSING ||
			readyState === undefined;

		const newLastSeen = Date.now();
		const newStatus = isConnectionClosed ? "reconnecting" : "connected";

		this.#actor.rLog.debug({
			msg: "liveness probe for connection",
			connId: this.id,
			actorId: this.#actor.id,
			readyState,

			status: this.#status,
			newStatus,

			lastSeen: this.__persist.lastSeen,
			currentTs: newLastSeen,
		});

		if (!isConnectionClosed) {
			this.__persist.lastSeen = newLastSeen;
		}

		this.#status = newStatus;
		return {
			status: this.#status,
			lastSeen: this.__persist.lastSeen,
		};
	}
}
