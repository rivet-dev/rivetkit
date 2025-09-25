import type { Hono } from "hono";
import { z } from "zod";
import { getEnvUniversal } from "@/utils";

export const ConfigSchema = z
	.object({
		app: z.custom<Hono>().optional(),
		endpoint: z
			.string()
			.default(
				() => getEnvUniversal("RIVET_ENGINE") ?? "http://localhost:6420",
			),
		// TODO: USe undefined instead of null
		token: z
			.string()
			.nullable()
			.default(() => getEnvUniversal("RIVET_TOKEN") ?? null),
		pegboardEndpoint: z.string().optional(),
		namespace: z
			.string()
			.default(() => getEnvUniversal("RIVET_NAMESPACE") ?? "default"),
		runnerName: z
			.string()
			.default(() => getEnvUniversal("RIVET_RUNNER") ?? "rivetkit"),
		// TODO: Automatically attempt to determine key by common env vars (e.g. k8s pod name)
		runnerKey: z
			.string()
			.default(
				() => getEnvUniversal("RIVET_RUNNER_KEY") ?? crypto.randomUUID(),
			),
		totalSlots: z.number().default(100_000),
	})
	.default({});

export type InputConfig = z.input<typeof ConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
