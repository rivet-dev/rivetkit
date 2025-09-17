import { toNextHandler } from "@rivetkit/next-js";
import { registry } from "@/rivet/registry";

export const { GET, POST, HEAD, PATCH, OPTIONS } = toNextHandler(registry);
