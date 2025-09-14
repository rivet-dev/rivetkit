import { join } from "node:path";
import { createClientWithDriver } from "@/client/client";
import { createTestRuntime, runDriverTests } from "@/driver-test-suite/mod";
import { createEngineDriver } from "@/drivers/engine/mod";
import { createInlineClientDriver } from "@/inline-client-driver/mod";
import { RunConfigSchema } from "@/registry/run-config";
import { getPort } from "@/test/mod";

runDriverTests({
	// Use real timers for engine-runner tests
	useRealTimers: true,
	skip: {
		// Skip tests that aren't applicable for engine-runner
		schedule: true, // Scheduling handled by engine
	},
	async start(projectPath: string) {
		return await createTestRuntime(
			join(projectPath, "registry.ts"),
			async (registry) => {
				// Get configuration from environment or use defaults
				const endpoint = process.env.RIVET_ENDPOINT || "http://localhost:6420";
				const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;

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
					runnerName: "test-runner",
					totalSlots: 1000,
				});

				// Start the actor driver
				const runConfig = RunConfigSchema.parse({
					driver: driverConfig,
					getUpgradeWebSocket: () => undefined,
				});
				const managerDriver = driverConfig.manager(registry.config, runConfig);
				const inlineClientDriver = createInlineClientDriver(managerDriver);
				const inlineClient = createClientWithDriver(inlineClientDriver);
				const actorDriver = driverConfig.actor(
					registry.config,
					runConfig,
					managerDriver,
					inlineClient,
				);

				return {
					driver: driverConfig,
					cleanup: async () => {
						await actorDriver.shutdown?.(true);
					},
				};
			},
		);
	},
});
