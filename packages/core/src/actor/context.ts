import type { ActorKey } from "@/actor/mod";
import type { Client } from "@/client/client";
import type { Logger } from "@/common/log";
import type { Registry } from "@/registry/mod";
import type { Conn, ConnId } from "./connection";
import type { AnyDatabaseProvider, InferDatabaseClient } from "./database";
import type { ActorInstance, SaveStateOptions } from "./instance";
import type { Schedule } from "./schedule";

/**
 * ActorContext class that provides access to actor methods and state
 */
export class ActorContext<
	TState,
	TConnParams,
	TConnState,
	TVars,
	TInput,
	TAuthData,
	TDatabase extends AnyDatabaseProvider,
> {
	#actor: ActorInstance<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	>;

	constructor(
		actor: ActorInstance<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
	) {
		this.#actor = actor;
	}

	/**
	 * Get the actor state
	 */
	get state(): TState {
		return this.#actor.state;
	}

	/**
	 * Get the actor variables
	 */
	get vars(): TVars {
		return this.#actor.vars;
	}

	/**
	 * Broadcasts an event to all connected clients.
	 * @param name - The name of the event.
	 * @param args - The arguments to send with the event.
	 */
	broadcast<Args extends Array<unknown>>(name: string, ...args: Args): void {
		this.#actor._broadcast(name, ...args);
		return;
	}

	/**
	 * Gets the logger instance.
	 */
	get log(): Logger {
		return this.#actor.log;
	}

	/**
	 * Gets actor ID.
	 */
	get actorId(): string {
		return this.#actor.id;
	}

	/**
	 * Gets the actor name.
	 */
	get name(): string {
		return this.#actor.name;
	}

	/**
	 * Gets the actor key.
	 */
	get key(): ActorKey {
		return this.#actor.key;
	}

	/**
	 * Gets the region.
	 */
	get region(): string {
		return this.#actor.region;
	}

	/**
	 * Gets the scheduler.
	 */
	get schedule(): Schedule {
		return this.#actor.schedule;
	}

	/**
	 * Gets the map of connections.
	 */
	get conns(): Map<
		ConnId,
		Conn<TState, TConnParams, TConnState, TVars, TInput, TAuthData, TDatabase>
	> {
		return this.#actor.conns;
	}

	/**
	 * Returns the client for the given registry.
	 */
	client<R extends Registry<any>>(): Client<R> {
		return this.#actor.inlineClient as Client<R>;
	}

	/**
	 * Gets the database.
	 * @experimental
	 * @throws {DatabaseNotEnabled} If the database is not enabled.
	 */
	get db(): InferDatabaseClient<TDatabase> {
		return this.#actor.db;
	}

	/**
	 * Forces the state to get saved.
	 *
	 * @param opts - Options for saving the state.
	 */
	async saveState(opts: SaveStateOptions): Promise<void> {
		return this.#actor.saveState(opts);
	}

	/**
	 * Runs a promise in the background.
	 *
	 * @param promise - The promise to run in the background.
	 */
	runInBackground(promise: Promise<void>): void {
		this.#actor._runInBackground(promise);
	}

	/**
	 * Forces the actor to sleep.
	 *
	 * Not supported on all drivers.
	 *
	 * @experimental
	 */
	sleep() {
		this.#actor._sleep();
	}
}
