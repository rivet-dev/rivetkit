import { getLogger } from "@rivetkit/core/log";

export const LOGGER_NAME = "driver-redis";

export function logger() {
	return getLogger(LOGGER_NAME);
}
