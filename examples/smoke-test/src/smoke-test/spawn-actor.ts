import { performance } from "node:perf_hooks";
import type { createClient } from "rivetkit/client";
import type { Registry } from "../server/registry";

export type SmokeTestError = {
	index: number;
	error: unknown;
};

export type RegistryClient = ReturnType<typeof createClient<Registry>>;

export type SpawnActorOptions = {
	client: RegistryClient;
	index: number;
	testId: string;
	errors: SmokeTestError[];
	iterationDurations: number[];
	onSuccess: () => void;
	onFailure: () => void;
};

export async function spawnActor({
	client,
	index,
	testId,
	errors,
	iterationDurations,
	onSuccess,
	onFailure,
}: SpawnActorOptions): Promise<void> {
	const iterationStart = performance.now();
	let succeeded = false;

	try {
		const key = ["test", testId, index.toString()];
		const counter = client.counter.getOrCreate(key).connect();
		await counter.increment(1);
		await counter.dispose();

		// Immediately reconnect
		const counter2 = client.counter.getOrCreate(key).connect();
		await counter2.increment(1);
		await counter2.dispose();

		// Wait for actor to sleep
		await new Promise((res) => setTimeout(res, 1000));

		// Reconnect after sleep
		const counter3 = client.counter.getOrCreate(key).connect();
		await counter3.increment(1);
		await counter3.dispose();

		succeeded = true;
		onSuccess();
	} catch (error) {
		errors.push({ index, error });
		onFailure();
	}

	if (succeeded) {
		const iterationEnd = performance.now();
		const iterationDuration = iterationEnd - iterationStart;
		iterationDurations.push(iterationDuration);
	}
}
