import { z } from "zod";

export const RivetIdSchema = z.string();
export type RivetId = z.infer<typeof RivetIdSchema>;

export const ActorSchema = z.object({
	actor_id: RivetIdSchema,
	name: z.string(),
	key: z.string(),
	namespace_id: RivetIdSchema,
	runner_name_selector: z.string(),
	create_ts: z.number(),
	connectable_ts: z.number().nullable().optional(),
	destroy_ts: z.number().nullable().optional(),
	sleep_ts: z.number().nullable().optional(),
	start_ts: z.number().nullable().optional(),
});
export type Actor = z.infer<typeof ActorSchema>;
