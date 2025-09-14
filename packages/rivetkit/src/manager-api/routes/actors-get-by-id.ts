import { z } from "zod";
import { RivetIdSchema } from "./common";

export const ActorsGetByIdResponseSchema = z.object({
	actor_id: RivetIdSchema.nullable().optional(),
});
export type ActorsGetByIdResponse = z.infer<typeof ActorsGetByIdResponseSchema>;
