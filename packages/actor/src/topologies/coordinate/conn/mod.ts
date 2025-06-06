import type { GlobalState } from "@/topologies/coordinate/topology";
import type * as messageToClient from "@/actor/protocol/message/to-client";
import * as errors from "@/actor/errors";
import type { CoordinateDriver } from "../driver";
import { logger } from "../log";
import { ActorPeer } from "../actor-peer";
import { publishMessageToLeader } from "../node/message";
import { generateConnId, generateConnToken } from "@/actor/connection";
import type { ActorDriver } from "@/actor/driver";
import { DriverConfig } from "@/driver-helpers/config";
import { AppConfig } from "@/app/config";

export interface RelayConnDriver {
	sendMessage(message: messageToClient.ToClient): void;
	disconnect(reason?: string): Promise<void>;
}

/**
 * This is different than `Connection`. `Connection` represents the data of the connection state on the actor itself, `RelayConnection` supports managing a connection for an actor running on another machine over pubsub.
 */
export class RelayConn {
	#appConfig: AppConfig;
	#driverConfig: DriverConfig;
	#coordinateDriver: CoordinateDriver;
	#actorDriver: ActorDriver;
	#globalState: GlobalState;
	#driver: RelayConnDriver;
	#actorId: string;
	#parameters: unknown;

	#actorPeer?: ActorPeer;

	#connId?: string;
	#connToken?: string;

	#disposed = false;

	#abortController = new AbortController();

	public get connId(): string {
		if (!this.#connId) throw new errors.InternalError("Missing connId");
		return this.#connId;
	}

	public get connToken(): string {
		if (!this.#connToken) throw new errors.InternalError("Missing connToken");
		return this.#connToken;
	}

	constructor(
		appConfig: AppConfig,
		driverConfig: DriverConfig,
		actorDriver: ActorDriver,
		CoordinateDriver: CoordinateDriver,
		globalState: GlobalState,
		driver: RelayConnDriver,
		actorId: string,
		parameters: unknown,
	) {
		this.#appConfig = appConfig;
		this.#driverConfig = driverConfig;
		this.#coordinateDriver = CoordinateDriver;
		this.#actorDriver = actorDriver;
		this.#driver = driver;
		this.#globalState = globalState;
		this.#actorId = actorId;
		this.#parameters = parameters;
	}

	async start() {
		// TODO: Handle errors graecfully

		// Add connection
		const connId = generateConnId();
		const connToken = generateConnToken();
		this.#connId = connId;
		this.#connToken = connToken;

		logger().info("starting relay connection", {
			actorId: this.#actorId,
			connId: this.#connId,
		});

		// Create actor peer
		this.#actorPeer = await ActorPeer.acquire(
			this.#appConfig,
			this.#driverConfig,
			this.#actorDriver,
			this.#coordinateDriver,
			this.#globalState,
			this.#actorId,
			connId,
		);

		this.#globalState.relayConns.set(connId, this);

		// Publish connection open
		await publishMessageToLeader(
			this.#appConfig,
			this.#driverConfig,
			this.#coordinateDriver,
			this.#globalState,
			this.#actorId,
			{
				b: {
					lco: {
						ai: this.#actorId,
						ci: connId,
						ct: connToken,
						p: this.#parameters,
					},
				},
			},
			this.#abortController.signal,
		);

		// The leader will send the connection init to the client or close if invalid
	}

	onMessage(message: messageToClient.ToClient) {
		this.#driver.sendMessage(message);
	}

	/**
	 * Closes the connection and cleans it up.
	 *
	 * @param fromLeader - If this message is coming from the leader. This will prevent sending a close message back to the leader.
	 */
	async disconnect(fromLeader: boolean, reason?: string) {
		if (this.#disposed) return;

		this.#disposed = true;

		this.#abortController.abort();

		// Disconnect driver
		await this.#driver.disconnect(reason);

		// Clean up state
		if (this.#connId) {
			// Remove connection
			this.#globalState.relayConns.delete(this.#connId);

			// Publish connection close
			if (!fromLeader && this.#actorPeer?.leaderNodeId) {
				// Publish connection close
				await publishMessageToLeader(
					this.#appConfig,
					this.#driverConfig,
					this.#coordinateDriver,
					this.#globalState,
					this.#actorId,
					{
						b: {
							lcc: {
								ai: this.#actorId,
								ci: this.#connId,
							},
						},
					},
					undefined
				);
			}

			// Remove reference to actor (will shut down if no more references)
			//
			// IMPORTANT: Do this last since we need to send the connection close event
			await this.#actorPeer?.removeConnectionReference(this.#connId);
		} else {
			logger().warn("disposing connection without connection id");
		}
	}
}
