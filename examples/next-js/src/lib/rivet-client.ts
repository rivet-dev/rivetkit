"use client";
import { createClient, createRivetKit } from "@rivetkit/next-js/client";
import type { registry } from "@/rivet/registry";

const client = createClient<typeof registry>(
	process.env.NEXT_RIVET_ENDPOINT ?? "http://localhost:3000/api/rivet",
);
export const { useActor } = createRivetKit(client);
