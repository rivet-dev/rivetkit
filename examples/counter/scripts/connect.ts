import { createClient } from "rivetkit/client";
import type { Registry } from "../src/registry";

// async function main() {
// 	const client = createClient<Registry>();
//
// 	const counter = await client.counter.getOrCreate().connect();
//
// 	counter.on("newCount", (count: number) => console.log("Event:", count));
//
// 	for (let i = 0; i < 5; i++) {
// 		const out = await counter.increment(5);
// 		console.log("RPC:", out);
//
// 		await new Promise((resolve) => setTimeout(resolve, 1000));
// 	}
//
// 	await new Promise((resolve) => setTimeout(resolve, 10000));
// 	await counter.dispose();
// }

async function main() {
	const client = createClient<Registry>();

	const counter = await client.counter.getOrCreate();

	for (let i = 0; i < 5; i++) {
		const out = await counter.increment(5);
		console.log("RPC:", out);

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
}

main();
