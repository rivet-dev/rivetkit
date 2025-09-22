import { upgradeWebSocket } from "hono/deno";
import { registry } from "./registry.ts";

const { fetch } = registry.start({
	// Deno requires using Deno.serve
	disableServer: true,
	// Specify Deno-specific upgradeWebSocket
	getUpgradeWebSocket: () => upgradeWebSocket,
});

// Start server
Deno.serve({ port: 8080 }, fetch);
