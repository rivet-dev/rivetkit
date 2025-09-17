"use client";
import { createClient, createRivetKit } from "@rivetkit/next-js/client";
import type { registry } from "@/rivet/registry";

const getOrigin = () => {
	if (typeof window !== "undefined") {
		return window.location.origin;
	}
	// Fallback for SSR or when window is not available
	return process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
};

const client = createClient<typeof registry>({
	endpoint: `${getOrigin()}/api/rivet`,
	transport: "sse",
});
export const { useActor } = createRivetKit(client);
