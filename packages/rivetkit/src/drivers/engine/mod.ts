import type { Client } from "@/client/client";
import type { ManagerDriver } from "@/manager/driver";
import type { RegistryConfig } from "@/registry/config";
import type { DriverConfig, RunConfig } from "@/registry/run-config";
import { RemoteManagerDriver } from "@/remote-manager-driver/mod";
import { EngineActorDriver } from "./actor-driver";
import { ConfigSchema, type InputConfig } from "./config";

export { EngineActorDriver } from "./actor-driver";
export { type Config, ConfigSchema, type InputConfig } from "./config";

export function createEngineDriver(inputConfig?: InputConfig): DriverConfig {
	const config = ConfigSchema.parse(inputConfig);

	return {
		name: "engine",
		manager: (_registryConfig, runConfig) => {
			return new RemoteManagerDriver(runConfig);
		},
		actor: (
			registryConfig: RegistryConfig,
			runConfig: RunConfig,
			managerDriver: ManagerDriver,
			inlineClient: Client<any>,
		) => {
			return new EngineActorDriver(
				registryConfig,
				runConfig,
				managerDriver,
				inlineClient,
				config,
			);
		},
	};
}
