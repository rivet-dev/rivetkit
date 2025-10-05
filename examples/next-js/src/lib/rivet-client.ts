"use client";
import { createClient, createRivetKit } from "@rivetkit/next-js/client";
import type { registry } from "@/rivet/registry";

// TODO: Auto-trigger start by sending request to health endpoint

const client = createClient<typeof registry>();
export const { useActor } = createRivetKit(client);
