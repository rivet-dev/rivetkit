import { UserError } from "@/actor/errors";
import { loggerWithoutContext } from "@/actor/log";
import { createEngineDriver } from "@/drivers/engine/mod";
import { createFileSystemOrMemoryDriver } from "@/drivers/file-system/mod";
import type { DriverConfig, RunConfig } from "@/registry/run-config";

/**
 * Chooses the appropriate driver based on the run configuration.
 */
export function chooseDefaultDriver(runConfig: RunConfig): DriverConfig {
	if (runConfig.endpoint && runConfig.driver) {
		throw new UserError(
			"Cannot specify both 'engine' and 'driver' in configuration",
		);
	}

	if (runConfig.driver) {
		return runConfig.driver;
	}

	if (runConfig.endpoint) {
		loggerWithoutContext().debug({
			msg: "using rivet engine driver",
			endpoint: runConfig.endpoint,
		});
		// TODO: Add all properties from config
		return createEngineDriver({
			endpoint: runConfig.endpoint,
			token: runConfig.token ?? undefined,
		});
	}

	loggerWithoutContext().debug({ msg: "using default file system driver" });
	return createFileSystemOrMemoryDriver(true);
}
