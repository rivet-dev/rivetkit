import { DriverConfigSchema } from "@rivetkit/actor/driver-helpers";
import { z } from "zod";

export const ConfigSchema = DriverConfigSchema.extend({
	mode: z.enum(["file-system", "memory"]).optional().default("file-system"),
	hostname: z
		.string()
		.optional()
		.default(process.env.HOSTNAME ?? "127.0.0.1"),
	port: z
		.number()
		.optional()
		.default(Number.parseInt(process.env.PORT ?? "6420")),
}).default({});
export type InputConfig = z.input<typeof ConfigSchema>;
