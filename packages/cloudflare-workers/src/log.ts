import { getLogger } from "rivetkit/log";

export function logger() {
	return getLogger("driver-cloudflare-workers");
}
