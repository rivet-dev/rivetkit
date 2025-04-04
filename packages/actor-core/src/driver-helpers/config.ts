//! These configs configs hold anything specific to the driver.
//!
//! This should only include parameters that affect the low-level infrastructure and does not affect behavior of actors. Configuring parameters in this block should not tweak how actors behave at all.
//!
//! For example, Rivet doesn't expose this functionality to the user at all and is completely configured automatically.

import { z } from "zod";
import type {
	Hono,
	Context as HonoContext,
	Handler as HonoHandler,
} from "hono";
import type { CoordinateDriver } from "@/topologies/coordinate/driver";
import type { ManagerDriver } from "@/manager/driver";
import type { ActorDriver } from "@/actor/driver";
import type { InspectorConnHandler } from "@/inspector/common";

export const TopologySchema = z.enum(["standalone", "partition", "coordinate"]);
export type Topology = z.infer<typeof TopologySchema>;

export type GetUpgradeWebSocket = (
	app: Hono,
) => (createEvents: (c: HonoContext) => any) => HonoHandler;

/** Base config used for the actor config across all platforms. */
export const DriverConfigSchema = z.object({
	topology: TopologySchema.optional(), // Default value depends on the platform selected
	drivers: z
		.object({
			manager: z.custom<ManagerDriver>().optional(),
			actor: z.custom<ActorDriver>().optional(),
			coordinate: z.custom<CoordinateDriver>().optional(),
		})
		.optional()
		.default({}),
	// This is dynamic since NodeJS requires a reference to the app to initialize WebSockets
	getUpgradeWebSocket: z.custom<GetUpgradeWebSocket>().optional(),
});
export type DriverConfig = z.infer<typeof DriverConfigSchema>;
