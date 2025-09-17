import { join } from "node:path";
import { createClientWithDriver } from "@/client/client";
import { createTestRuntime, runDriverTests } from "@/driver-test-suite/mod";
import { createEngineDriver } from "@/drivers/engine/mod";
import { RunConfigSchema } from "@/registry/run-config";
import { getPort } from "@/test/mod";

runDriverTests({
	// Use real timers for engine-runner tests
	useRealTimers: true,
	skip: {
		// Skip tests that aren't applicable for engine-runner
		schedule: true, // Scheduling handled by engine
	},
	async start() {
		return await createTestRuntime(
			join(__dirname, "../fixtures/driver-test-suite/registry.ts"),
			async (registry) => {
				// Get configuration from environment or use defaults
				const endpoint = process.env.RIVET_ENDPOINT || "http://localhost:6420";
				const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
				const runnerName = "test-runner";

				// Create namespace
				const response = await fetch(`${endpoint}/namespaces`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						name: namespace,
						display_name: namespace,
					}),
				});
				if (!response.ok) {
					throw "Create namespace failed";
				}

				// Create driver config
				const driverConfig = createEngineDriver({
					endpoint,
					namespace,
					runnerName,
					totalSlots: 1000,
				});

				// Start the actor driver
				const runConfig = RunConfigSchema.parse({
					driver: driverConfig,
					getUpgradeWebSocket: () => undefined,
				});
				const managerDriver = driverConfig.manager(registry.config, runConfig);
				const inlineClient = createClientWithDriver(managerDriver, runConfig);
				const actorDriver = driverConfig.actor(
					registry.config,
					runConfig,
					managerDriver,
					inlineClient,
				);

				return {
					rivetEngine: {
						endpoint: "http://127.0.0.1:6420",
						namespace: namespace,
						runnerName: runnerName,
					},
					driver: driverConfig,
					cleanup: async () => {
						await actorDriver.shutdown?.(true);
					},
				};
			},
		);
	},
});
