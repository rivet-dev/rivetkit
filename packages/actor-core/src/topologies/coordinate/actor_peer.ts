import { BaseConfig } from "@/actor/runtime/config";
import type { GlobalState } from "@/topologies/coordinate/topology";
import { logger } from "./log";
import type { CoordinateDriver } from "./driver";
import type { Actor, AnyActor } from "@/actor/runtime/actor";
import type { ActorTags } from "@/common/utils";
import { ActorDriver } from "@/actor/runtime/driver";
import {
	CONN_DRIVER_COORDINATE_RELAY,
	createCoordinateRelayDriver,
} from "./conn/driver";

export class ActorPeer {
	#config: BaseConfig;
	#coordinateDriver: CoordinateDriver;
	#actorDriver: ActorDriver;
	#globalState: GlobalState;
	#actorId: string;
	#actorTags?: ActorTags;
	#isDisposed = false;

	/** Connections that hold a reference to this actor. If this set is empty, the actor should be shut down. */
	#referenceConnections = new Set<string>();

	/** Node ID that's the leader for this actor. */
	#leaderNodeId?: string;

	/** Holds the insantiated actor class if is leader. */
	#loadedActor?: Actor;

	#heartbeatTimeout?: NodeJS.Timeout;

	get #isLeader() {
		return this.#leaderNodeId === this.#globalState.nodeId;
	}

	get leaderNodeId() {
		if (!this.#leaderNodeId) throw new Error("Not found leader node ID yet");
		return this.#leaderNodeId;
	}

	constructor(
		config: BaseConfig,
		CoordinateDriver: CoordinateDriver,
		actorDriver: ActorDriver,
		globalState: GlobalState,
		actorId: string,
	) {
		this.#config = config;
		this.#coordinateDriver = CoordinateDriver;
		this.#actorDriver = actorDriver;
		this.#globalState = globalState;
		this.#actorId = actorId;
	}

	/** Acquires a `ActorPeer` for a connection and includes the connection ID in the references. */
	static async acquire(
		config: BaseConfig,
		actorDriver: ActorDriver,
		CoordinateDriver: CoordinateDriver,
		globalState: GlobalState,
		actorId: string,
		connId: string,
	): Promise<ActorPeer> {
		let peer = globalState.actorPeers.get(actorId);

		// Create peer if needed
		if (!peer) {
			peer = new ActorPeer(
				config,
				CoordinateDriver,
				actorDriver,
				globalState,
				actorId,
			);
			globalState.actorPeers.set(actorId, peer);
			await peer.#start();
		}

		peer.#referenceConnections.add(connId);

		logger().debug("added actor reference", {
			actorId,
			connId,
			newReferenceCount: peer.#referenceConnections.size,
		});

		return peer;
	}

	static getLeaderActor(
		globalState: GlobalState,
		actorId: string,
	): AnyActor | undefined {
		const peer = globalState.actorPeers.get(actorId);
		if (!peer) return undefined;
		if (peer.#isLeader) {
			const actor = peer.#loadedActor;
			if (!actor)
				throw new Error("Actor is leader, but loadedActor is undefined");
			return actor;
		} else {
			return undefined;
		}
	}

	async #start() {
		// TODO: Handle errors graecfully
		// TODO: See redlock

		// TODO: renew lease
		// TODO: receive messages for new connections
		// TODO: listen for health check on connections
		// TODO: Close sub on connection close
		// TODO: Use a global Redis connection
		// TODO: Add TTL to connections
		// TODO: Maybe use queue for leader instead of pubsub so the P2P is durable
		// TODO: Remove actor from globalState

		// TODO: Add back NX
		// Acquire lease

		// TODO: Do this in 1 round trip with a Lua script

		// Acquire initial information
		const { actor } = await this.#coordinateDriver.startActorAndAcquireLease(
			this.#actorId,
			this.#globalState.nodeId,
			this.#config.actorPeer.leaseDuration,
		);
		// Log
		logger().debug("starting actor peer", {
			actor,
		});

		// Validate actor exists
		if (!actor) {
			throw new Error("Actor does not exist");
		}

		// Parse tags
		this.#actorTags = actor.tags;

		// Handle leadership
		this.#leaderNodeId = actor.leaderNodeId;
		if (actor.leaderNodeId === this.#globalState.nodeId) {
			logger().debug("actor peer is leader", {
				actorId: this.#actorId,
				leaderNodeId: actor.leaderNodeId,
			});

			await this.#convertToLeader();
		} else {
			logger().debug("actor peer is follower", {
				actorId: this.#actorId,
				leaderNodeId: actor.leaderNodeId,
			});

			this.#leaderNodeId = actor.leaderNodeId;
		}

		// Schedule first heartbeat
		this.#scheduleHeartbeat();
	}

	async #heartbeat() {
		if (this.#isDisposed) return;

		// Execute heartbeat
		if (this.#isLeader) {
			await this.#extendLease();
		} else {
			await this.#attemptAcquireLease();
		}

		this.#scheduleHeartbeat();
	}

	#scheduleHeartbeat() {
		// Schedule next heartbeat (leadership status may have changed)
		let hbTimeout: number;
		if (this.#isLeader) {
			hbTimeout =
				this.#config.actorPeer.leaseDuration -
				this.#config.actorPeer.renewLeaseGrace;
		} else {
			// TODO: Add jitter
			hbTimeout =
				this.#config.actorPeer.checkLeaseInterval +
				Math.random() * this.#config.actorPeer.checkLeaseJitter;
		}
		if (hbTimeout < 0)
			throw new Error("Actor peer heartbeat timeout is negative, check config");
		this.#heartbeatTimeout = setTimeout(this.#heartbeat.bind(this), hbTimeout);
	}

	async #convertToLeader() {
		if (!this.#actorTags) throw new Error("missing tags");

		logger().debug("peer acquired leadership", { actorId: this.#actorId });

		// Build actor
		const actorName = this.#actorTags.name;
		const prototype = this.#config.actors[actorName];
		if (!prototype) throw new Error(`no actor for name ${prototype}`);

		// Create leader actor
		const actor = new prototype();
		this.#loadedActor = actor;

		await actor.__start(
			{
				[CONN_DRIVER_COORDINATE_RELAY]: createCoordinateRelayDriver(
					this.#globalState,
					this.#coordinateDriver,
				),
			},
			this.#actorDriver,
			this.#actorId,
			this.#actorTags,
			"unknown",
		);
	}

	/**
	 * Extends the lease if the current leader. Called on an interval for leaders leader.
	 *
	 * If the lease has expired for any reason (e.g. connection latency or database purged), this will automatically shut down the actor.
	 */
	async #extendLease() {
		const { leaseValid } = await this.#coordinateDriver.extendLease(
			this.#actorId,
			this.#globalState.nodeId,
			this.#config.actorPeer.leaseDuration,
		);
		if (leaseValid) {
			logger().debug("lease is valid", { actorId: this.#actorId });
		} else {
			logger().debug("lease is invalid", { actorId: this.#actorId });

			// Shut down. SInce the lease is already lost, no need to clear it.
			await this.#dispose(false);
		}
	}

	/**
	 * Attempts to acquire a lease (aka checks if the leader's lease has expired). Called on an interval for followers.
	 */
	async #attemptAcquireLease() {
		const { newLeaderNodeId } =
			await this.#coordinateDriver.attemptAcquireLease(
				this.#actorId,
				this.#globalState.nodeId,
				this.#config.actorPeer.leaseDuration,
			);

		// Check if the lease was successfully acquired and promoted to leader
		const isPromoted =
			!this.#isLeader && newLeaderNodeId === this.#globalState.nodeId;

		// Save leader
		this.#leaderNodeId = newLeaderNodeId;

		// Promote as leader if needed
		if (isPromoted) {
			if (!this.#isLeader) throw new Error("assert: should be promoted");

			this.#convertToLeader();
		}
	}

	async removeConnectionReference(connId: string) {
		const removed = this.#referenceConnections.delete(connId);

		if (removed) {
			logger().debug("removed actor reference", {
				actorId: this.#actorId,
				connId,
				newReferenceCount: this.#referenceConnections.size,
			});
		} else {
			logger().warn("removed reference to actor that didn't exist", {
				actorId: this.#actorId,
				connId,
			});
		}

		if (this.#referenceConnections.size === 0) {
			this.#dispose(true);
		}
	}

	async #dispose(releaseLease: boolean) {
		if (this.#isDisposed) return;
		this.#isDisposed = true;

		logger().info("actor shutting down", { actorId: this.#actorId });

		// IMPORTANT: Do this before anything async
		clearTimeout(this.#heartbeatTimeout);
		this.#globalState.actorPeers.delete(this.#actorId);

		// Stop actor
		//
		// We wait for this to finish to ensure that state is persisted safely to storage
		if (this.#isLeader && this.#loadedActor) {
			await this.#loadedActor.__stop();
		}

		// Clear the lease if needed
		if (this.#isLeader && releaseLease) {
			await this.#coordinateDriver.releaseLease(
				this.#actorId,
				this.#globalState.nodeId,
			);
		}

		logger().info("actor shutdown success", { actorId: this.#actorId });
	}
}
