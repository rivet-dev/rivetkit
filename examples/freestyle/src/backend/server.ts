import { Context, Hono } from "hono";
import { serveStatic, upgradeWebSocket } from "hono/deno";
import { registry } from "./registry";

const serverOutput = registry.start({
	inspector: {
		enabled: true,
	},
	disableServer: true,
	getUpgradeWebSocket: () => upgradeWebSocket,
	cors: {
		origin: "http://localhost:5173",
		credentials: true,
	},
	basePath: "/api",
});

const app = new Hono();
app.use("/api/*", async (c) => {
	return await serverOutput.fetch(c.req.raw);
});
app.use("*", serveStatic({ root: "./public" }));

// @ts-ignore
// Under the hood, FreeStyle uses Deno
// for their Web Deploy instances
Deno.serve({ port: 8080 }, app.fetch);
