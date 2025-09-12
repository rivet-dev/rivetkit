import { getLogger } from "@/common/log";

export function logger() {
	return getLogger("actor-runtime");
}

export function instanceLogger() {
	return getLogger("actor");
}
