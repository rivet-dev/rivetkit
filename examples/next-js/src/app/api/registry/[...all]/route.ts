import { toNextHandler } from "@rivetkit/next-js";
import { registry } from "@/rivet/registry";

// TODO: This doesn't need to be hotsed via the Next API, but this should probably go elsewhere
const server = registry.start();

export const { GET, POST, HEAD, PATCH, OPTIONS } = toNextHandler(server);
