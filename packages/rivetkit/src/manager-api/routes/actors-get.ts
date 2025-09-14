import { z } from "zod";
import { ActorSchema } from "./common";

export const ActorsGetResponseSchema = z.object({
	actor: ActorSchema,
});
export type ActorsGetResponse = z.infer<typeof ActorsGetResponseSchema>;
