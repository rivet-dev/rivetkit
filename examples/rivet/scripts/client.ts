import { createClient } from "rivetkit/client";
import { execSync } from "node:child_process";
import type { Registry } from "../src/registry.js";

// Get endpoint from rivet kit
const endpoint = execSync("rivet kit endpoint", { encoding: "utf8" }).trim();
console.log("🔗 Using endpoint:", endpoint);

// Create RivetKit client
const client = createClient<Registry>(endpoint);

async function main() {
	console.log("🚀 Rivet Client Demo");

	try {
		// Create counter instance
		const counter = client.counter.getOrCreate("demo");

		// Increment counter
		console.log("Incrementing counter 'demo'...");
		const result1 = await counter.increment(1);
		console.log("New count:", result1);

		// Increment again with larger value
		console.log("Incrementing counter 'demo' by 5...");
		const result2 = await counter.increment(5);
		console.log("New count:", result2);

		// Create another counter
		const counter2 = client.counter.getOrCreate("another");
		console.log("Incrementing counter 'another' by 10...");
		const result3 = await counter2.increment(10);
		console.log("New count:", result3);

		console.log("✅ Demo completed!");
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	}
}

main().catch(console.error);