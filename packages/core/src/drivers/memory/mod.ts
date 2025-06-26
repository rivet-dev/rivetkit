import type { DriverConfig } from "@/registry/run-config";
import { MemoryManagerDriver } from "./manager";
import { MemoryGlobalState } from "./global-state";
import { MemoryActorDriver } from  "./actor";

export function createMemoryDriver(): DriverConfig {
	const state = new MemoryGlobalState();
	return {
		topology: "standalone",
		manager: new MemoryManagerDriver(state),
		actor: new MemoryActorDriver(state),
	};
}
