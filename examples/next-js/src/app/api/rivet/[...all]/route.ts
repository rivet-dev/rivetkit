import { toNextHandler } from "@rivetkit/next-js";
import { registry } from "@/rivet/registry";

export const maxDuration = 60;

export const { GET, POST, PUT, PATCH, HEAD, OPTIONS } = toNextHandler(registry);
