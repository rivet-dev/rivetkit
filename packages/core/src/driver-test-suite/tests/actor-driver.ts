import { describe } from "vitest";
import type { DriverTestConfig } from "../mod";
import { runActorScheduleTests } from "./actor-schedule";
import { runActorSleepTests } from "./actor-sleep";
import { runActorStateTests } from "./actor-state";

export function runActorDriverTests(driverTestConfig: DriverTestConfig) {
	describe("Actor Driver Tests", () => {
		// Run state persistence tests
		runActorStateTests(driverTestConfig);

		// Run scheduled alarms tests
		runActorScheduleTests(driverTestConfig);
	});
}

/** Actor driver tests that need to be tested for all transport mechanisms. */
export function runActorDriverTestsWithTransport(
	driverTestConfig: DriverTestConfig,
) {
	describe("Actor Driver Tests", () => {
		// Run actor sleep tests
		runActorSleepTests(driverTestConfig);
	});
}
