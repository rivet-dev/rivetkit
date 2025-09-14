import { z } from "zod";

export const ActorsDeleteResponseSchema = z.object({});
export type ActorsDeleteResponse = z.infer<typeof ActorsDeleteResponseSchema>;
