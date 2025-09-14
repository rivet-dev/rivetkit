import { z } from "zod";
import { ActorSchema } from "./common";

export const ActorsCreateRequestSchema = z.object({
	name: z.string(),
	runner_name_selector: z.string(),
	crash_policy: z.string(),
	key: z.string().nullable().optional(),
	input: z.string().nullable().optional(),
});
export type ActorsCreateRequest = z.infer<typeof ActorsCreateRequestSchema>;

export const ActorsCreateResponseSchema = z.object({
	actor: ActorSchema,
});
export type ActorsCreateResponse = z.infer<typeof ActorsCreateResponseSchema>;
