import type { ActorKey } from "actor-core";

/**
 * Interface representing an actor's state
 */
export interface ActorState {
	// Basic actor information
	id: string;
	name: string;
	key: ActorKey;

	// Persisted data
	persistedData: unknown;
}

/**
 * Global state singleton for the memory driver
 */
export class MemoryGlobalState {
	#actors: Map<string, ActorState> = new Map();

	#getActor(actorId: string): ActorState {
		const actor = this.#actors.get(actorId);
		if (!actor) {
			throw new Error(`Actor does not exist for ID: ${actorId}`);
		}
		return actor;
	}

	readPersistedData(actorId: string): unknown | undefined {
		return this.#getActor(actorId).persistedData;
	}

	writePersistedData(actorId: string, data: unknown) {
		this.#getActor(actorId).persistedData = data;
	}

	createActor(actorId: string, name: string, key: ActorKey): void {
		// Create actor state if it doesn't exist
		if (!this.#actors.has(actorId)) {
			this.#actors.set(actorId, {
				id: actorId,
				name,
				key,
				persistedData: undefined
			});
		} else {
			throw new Error(`Actor already exists for ID: ${actorId}`);
		}
	}

	findActor(filter: (actor: ActorState) => boolean): ActorState | undefined {
		for (const actor of this.#actors.values()) {
			if (filter(actor)) {
				return actor;
			}
		}
		return undefined;
	}

	getActor(actorId: string): ActorState | undefined {
		return this.#actors.get(actorId);
	}

	getAllActors(): ActorState[] {
		return Array.from(this.#actors.values());
	}
}
