import { z } from "zod";
import { ActorSchema, RivetIdSchema } from "./common";

export const ActorsGetOrCreateResponseSchema = z.object({
	actor: ActorSchema,
	created: z.boolean(),
});
export type ActorsGetOrCreateResponse = z.infer<
	typeof ActorsGetOrCreateResponseSchema
>;

export const ActorsGetOrCreateByIdResponseSchema = z.object({
	actor_id: RivetIdSchema,
	created: z.boolean(),
});
export type ActorsGetOrCreateByIdResponse = z.infer<
	typeof ActorsGetOrCreateByIdResponseSchema
>;

export const ActorsGetOrCreateByIdRequestSchema = z.object({
	name: z.string(),
	key: z.string(),
	runner_name_selector: z.string(),
	crash_policy: z.string(),
	input: z.string().nullable().optional(),
});
export type ActorsGetOrCreateByIdRequest = z.infer<
	typeof ActorsGetOrCreateByIdRequestSchema
>;
