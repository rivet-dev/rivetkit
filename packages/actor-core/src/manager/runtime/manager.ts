import { ActorsRequestSchema } from "@/manager/protocol/mod";
import { Hono, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import type { ManagerDriver } from "@/actor/runtime/driver";
import { logger } from "./log";
import { type ActorTags, assertUnreachable } from "@/common/utils";
import type { BaseConfig } from "@/driver-helpers";

export class Manager {
	#config: BaseConfig;
	#driver: ManagerDriver;

	router: Hono;

	public constructor(config: BaseConfig) {
		this.#config = config;

		if (!config.drivers?.manager)
			throw new Error("config.drivers.manager is not defined.");
		this.#driver = config.drivers.manager;

		this.router = this.#buildRouter();
	}

	#buildRouter() {
		const app = new Hono();

		// Apply CORS middleware if configured
		if (this.#config.cors) {
			app.use("*", cors(this.#config.cors));
		}

		app.get("/", (c) => {
			return c.text(
				"This is an ActorCore server.\n\nLearn more at https://actorcore.org",
			);
		});

		app.get("/health", (c) => {
			return c.text("ok");
		});

		app.route("/manager", this.#buildManagerRouter());

		return app;
	}

	#buildManagerRouter(): Hono {
		const managerApp = new Hono();

		managerApp.post("/actors", async (c: HonoContext) => {
			const { query } = ActorsRequestSchema.parse(await c.req.json());
			logger().debug("query", { query });

			const url = new URL(c.req.url);

			// Determine base URL to build endpoints from
			//
			// This is used to build actor endpoints
			let baseUrl = url.origin;
			if (this.#config.basePath) {
				const basePath = this.#config.basePath;
				if (!basePath.startsWith("/"))
					throw new Error("config.basePath must start with /");
				if (basePath.endsWith("/"))
					throw new Error("config.basePath must not end with /");
				baseUrl += basePath;
			}

			// Get the actor from the manager
			let actorOutput: { endpoint: string };
			if ("getForId" in query) {
				const output = await this.#driver.getForId({
					c,
					baseUrl: baseUrl,
					actorId: query.getForId.actorId,
				});
				if (!output)
					throw new Error(
						`Actor does not exist for ID: ${query.getForId.actorId}`,
					);
				actorOutput = output;
			} else if ("getOrCreateForTags" in query) {
				const tags = query.getOrCreateForTags.tags;
				if (!tags) throw new Error("Must define tags in getOrCreateForTags");

				const existingActor = await this.#driver.getWithTags({
					c,
					baseUrl: baseUrl,
					tags: tags as ActorTags,
				});
				if (existingActor) {
					// Actor exists
					actorOutput = existingActor;
				} else {
					if (query.getOrCreateForTags.create) {
						// Create if needed
						actorOutput = await this.#driver.createActor({
							c,
							baseUrl: baseUrl,
							...query.getOrCreateForTags.create,
						});
					} else {
						// Creation disabled
						throw new Error("Actor not found with tags or is private.");
					}
				}
			} else if ("create" in query) {
				actorOutput = await this.#driver.createActor({
					c,
					baseUrl: baseUrl,
					...query.create,
				});
			} else {
				assertUnreachable(query);
			}

			return c.json({
				endpoint: actorOutput.endpoint,
				supportedTransports: ["websocket", "sse"],
			});
		});

		return managerApp;
	}
}
