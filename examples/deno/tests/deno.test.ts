// import { assertEquals } from "jsr:@std/assert";
// import { Registry, registry } from "../src/registry";
// import { createClient } from "rivetkit/client";
// import { createMemoryDriver } from "rivetkit";
// import { RunConfigSchema } from "rivetkit/driver-helpers";

// Deno.test("it should count", async () => {
// 	registry.start({
// 		driver: createMemoryDriver(),
// 		inspector: {
// 			enabled: false
// 		}
// 	});
// 	await new Promise((resolve) => setTimeout(resolve, 100));

// 	const client = createClient<Registry>();
// 	const counter = client.counter.getOrCreate().connect();

// 	// Test initial count
// 	assertEquals(await counter.getCount(), 0);

// 	// Test event emission
// 	let eventCount = -1;
// 	counter.on("newCount", (count: number) => {
// 		eventCount = count;
// 	});

// 	// Test increment
// 	const incrementAmount = 5;
// 	const result = await counter.increment(incrementAmount);
// 	assertEquals(result, incrementAmount);

// 	// Verify event was emitted with correct count
// 	assertEquals(eventCount, incrementAmount);

// 	// Test multiple increments
// 	for (let i = 1; i <= 3; i++) {
// 		const newCount = await counter.increment(incrementAmount);
// 		assertEquals(newCount, incrementAmount * (i + 1));
// 		assertEquals(eventCount, incrementAmount * (i + 1));
// 	}

// 	// Verify final count
// 	assertEquals(await counter.getCount(), incrementAmount * 4);
// 	await client.dispose();

// });
