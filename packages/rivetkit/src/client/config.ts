import z from "zod";
import { TransportSchema } from "@/actor/protocol/old";
import { EncodingSchema } from "@/actor/protocol/serde";
import { getEnvUniversal, type UpgradeWebSocket } from "@/utils";

export type GetUpgradeWebSocket = () => UpgradeWebSocket;

export const ClientConfigSchema = z.object({
	/** Configure serving the API */
	api: z
		.object({
			host: z.string().default("127.0.0.1"),
			port: z.number().default(6420),
		})
		.default({}),

	/** Endpoint to connect to the Rivet engine. Can be configured via RIVET_ENGINE env var. */
	endpoint: z
		.string()
		.nullable()
		.default(() => getEnvUniversal("RIVET_ENGINE") ?? null),

	namespace: z
		.string()
		.default(() => getEnvUniversal("RIVET_NAMESPACE") ?? "default"),

	runnerName: z
		.string()
		.default(() => getEnvUniversal("RIVET_RUNNER") ?? "rivetkit"),

	encoding: EncodingSchema.default("bare"),

	transport: TransportSchema.default("websocket"),

	// This is a function to allow for lazy configuration of upgradeWebSocket on the
	// fly. This is required since the dependencies that upgradeWebSocket
	// (specifically Node.js) can sometimes only be specified after the router is
	// created or must be imported async using `await import(...)`
	getUpgradeWebSocket: z.custom<GetUpgradeWebSocket>().optional(),
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;

export type ClientConfigInput = z.input<typeof ClientConfigSchema>;
