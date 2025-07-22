import type { GenericConnGlobalState } from "@/actor/generic-conn-driver";
import type { AnyClient } from "@/client/client";
import type {
	ActorDriver,
	AnyActorInstance,
	ManagerDriver,
} from "@/driver-helpers/mod";
import type { RegistryConfig, RunConfig } from "@/mod";
import type { FileSystemGlobalState } from "./global-state";

export type ActorDriverContext = Record<never, never>;

/**
 * File System implementation of the Actor Driver
 */
export class FileSystemActorDriver implements ActorDriver {
	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#managerDriver: ManagerDriver;
	#inlineClient: AnyClient;
	#state: FileSystemGlobalState;

	constructor(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		managerDriver: ManagerDriver,
		inlineClient: AnyClient,
		state: FileSystemGlobalState,
	) {
		this.#registryConfig = registryConfig;
		this.#runConfig = runConfig;
		this.#managerDriver = managerDriver;
		this.#inlineClient = inlineClient;
		this.#state = state;
	}

	async loadActor(actorId: string): Promise<AnyActorInstance> {
		return this.#state.startActor(
			this.#registryConfig,
			this.#runConfig,
			this.#inlineClient,
			this,
			actorId,
		);
	}

	getGenericConnGlobalState(actorId: string): GenericConnGlobalState {
		return this.#state.getActorOrError(actorId).genericConnGlobalState;
	}

	/**
	 * Get the current storage directory path
	 */
	get storagePath(): string {
		return this.#state.storagePath;
	}

	getContext(_actorId: string): ActorDriverContext {
		return {};
	}

	async readPersistedData(actorId: string): Promise<Uint8Array | undefined> {
		return (await this.#state.loadActorStateOrError(actorId)).persistedData;
	}

	async writePersistedData(actorId: string, data: Uint8Array): Promise<void> {
		const entry = await this.#state.loadActorStateOrError(actorId);
		entry.persistedData = data;

		// Save state to disk
		await this.#state.writeActor(actorId);
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		const delay = Math.max(0, timestamp - Date.now());
		setTimeout(() => {
			actor.onAlarm();
		}, delay);
	}

	getDatabase(actorId: string): Promise<unknown | undefined> {
		return this.#state.createDatabase(actorId);
	}
}
