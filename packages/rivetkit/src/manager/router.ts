import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import * as cbor from "cbor-x";
import { Hono } from "hono";
import { cors as corsMiddleware } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import {
	ActorNotFound,
	FeatureNotImplemented,
	MissingActorHeader,
	Unsupported,
	WebSocketsNotEnabled,
} from "@/actor/errors";
import {
	handleRouteError,
	handleRouteNotFound,
	loggerMiddleware,
} from "@/common/router";
import { createManagerInspectorRouter } from "@/inspector/manager";
import { secureInspector } from "@/inspector/utils";
import {
	type ActorsCreateRequest,
	ActorsCreateRequestSchema,
	ActorsCreateResponseSchema,
} from "@/manager-api/routes/actors-create";
import { ActorsDeleteResponseSchema } from "@/manager-api/routes/actors-delete";
import { ActorsGetResponseSchema } from "@/manager-api/routes/actors-get";
import { ActorsGetByIdResponseSchema } from "@/manager-api/routes/actors-get-by-id";
import {
	type ActorsGetOrCreateByIdRequest,
	ActorsGetOrCreateByIdRequestSchema,
	ActorsGetOrCreateByIdResponseSchema,
} from "@/manager-api/routes/actors-get-or-create-by-id";
import { RivetIdSchema } from "@/manager-api/routes/common";
import type { RegistryConfig } from "@/registry/config";
import type { RunConfig } from "@/registry/run-config";
import type { ManagerDriver } from "./driver";
import { logger } from "./log";

function buildOpenApiResponses<T>(schema: T, validateBody: boolean) {
	return {
		200: {
			description: "Success",
			content: validateBody
				? {
						"application/json": {
							schema,
						},
					}
				: {},
		},
		400: {
			description: "User error",
		},
		500: {
			description: "Internal error",
		},
	};
}

export function createManagerRouter(
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	managerDriver: ManagerDriver,
	validateBody: boolean,
): { router: Hono; openapi: OpenAPIHono } {
	const router = new OpenAPIHono({ strict: false }).basePath(
		runConfig.basePath,
	);

	router.use("*", loggerMiddleware(logger()));

	const cors = runConfig.cors
		? corsMiddleware(runConfig.cors)
		: createMiddleware((_c, next) => next());

	// Actor proxy middleware - intercept requests with x-rivet-target=actor
	router.use("*", cors, async (c, next) => {
		const target = c.req.header("x-rivet-target");
		const actorId = c.req.header("x-rivet-actor");

		if (target === "actor") {
			if (!actorId) {
				throw new MissingActorHeader();
			}

			logger().debug({
				msg: "proxying request to actor",
				actorId,
				path: c.req.path,
				method: c.req.method,
			});

			// Handle WebSocket upgrade
			if (c.req.header("upgrade") === "websocket") {
				const upgradeWebSocket = runConfig.getUpgradeWebSocket?.();
				if (!upgradeWebSocket) {
					throw new WebSocketsNotEnabled();
				}

				// For WebSocket, use the driver's proxyWebSocket method
				// Extract any additional headers that might be needed
				const encoding =
					c.req.header("X-RivetKit-Encoding") ||
					c.req.header("x-rivet-encoding") ||
					"json";
				const connParams =
					c.req.header("X-RivetKit-Conn-Params") ||
					c.req.header("x-rivet-conn-params");
				const authData =
					c.req.header("X-RivetKit-Auth-Data") ||
					c.req.header("x-rivet-auth-data");

				// Include query string if present
				const pathWithQuery = c.req.url.includes("?")
					? c.req.path + c.req.url.substring(c.req.url.indexOf("?"))
					: c.req.path;

				return await managerDriver.proxyWebSocket(
					c,
					pathWithQuery,
					actorId,
					encoding as any, // Will be validated by driver
					connParams ? JSON.parse(connParams) : undefined,
					authData ? JSON.parse(authData) : undefined,
				);
			}

			// Handle regular HTTP requests
			// Preserve all headers except the routing headers
			const proxyHeaders = new Headers(c.req.raw.headers);
			proxyHeaders.delete("x-rivet-target");
			proxyHeaders.delete("x-rivet-actor");

			// Build the proxy request with the actor URL format
			const url = new URL(c.req.url);
			const proxyUrl = new URL(`http://actor${url.pathname}${url.search}`);

			const proxyRequest = new Request(proxyUrl, {
				method: c.req.method,
				headers: proxyHeaders,
				body: c.req.raw.body,
			});

			return await managerDriver.proxyRequest(c, proxyRequest, actorId);
		}

		return next();
	});

	// GET /
	router.get("/", cors, (c) => {
		return c.text(
			"This is a RivetKit server.\n\nLearn more at https://rivetkit.org",
		);
	});

	// GET /actors/by-id
	{
		const route = createRoute({
			middleware: [cors],
			method: "get",
			path: "/actors/by-id",
			request: {
				query: z.object({
					name: z.string(),
					key: z.string(),
				}),
			},
			responses: buildOpenApiResponses(
				ActorsGetByIdResponseSchema,
				validateBody,
			),
		});

		router.openapi(route, async (c) => {
			const { name, key } = c.req.valid("query");

			// Get actor by key from the driver
			const actorOutput = await managerDriver.getWithKey({
				c,
				name,
				key: [key], // Convert string to ActorKey array
			});

			return c.json({
				actor_id: actorOutput?.actorId || null,
			});
		});
	}

	// PUT /actors/by-id
	{
		const route = createRoute({
			cors: [cors],
			method: "put",
			path: "/actors/by-id",
			request: {
				body: {
					content: validateBody
						? {
								"application/json": {
									schema: ActorsGetOrCreateByIdRequestSchema,
								},
							}
						: {},
				},
			},
			responses: buildOpenApiResponses(
				ActorsGetOrCreateByIdResponseSchema,
				validateBody,
			),
		});

		router.openapi(route, async (c) => {
			const body = validateBody
				? await c.req.json<ActorsGetOrCreateByIdRequest>()
				: await c.req.json();

			// Parse and validate the request body if validation is enabled
			if (validateBody) {
				ActorsGetOrCreateByIdRequestSchema.parse(body);
			}

			// Check if actor already exists
			const existingActor = await managerDriver.getWithKey({
				c,
				name: body.name,
				key: [body.key], // Convert string to ActorKey array
			});

			if (existingActor) {
				return c.json({
					actor_id: existingActor.actorId,
					created: false,
				});
			}

			// Create new actor
			const newActor = await managerDriver.getOrCreateWithKey({
				c,
				name: body.name,
				key: [body.key], // Convert string to ActorKey array
				input: body.input
					? cbor.decode(Buffer.from(body.input, "base64"))
					: undefined,
				region: undefined, // Not provided in the request schema
			});

			return c.json({
				actor_id: newActor.actorId,
				created: true,
			});
		});
	}

	// GET /actors/{actor_id}
	{
		const route = createRoute({
			middleware: [cors],
			method: "get",
			path: "/actors/{actor_id}",
			request: {
				params: z.object({
					actor_id: RivetIdSchema,
				}),
			},
			responses: buildOpenApiResponses(ActorsGetResponseSchema, validateBody),
		});

		router.openapi(route, async (c) => {
			const { actor_id } = c.req.valid("param");

			// Get actor by ID from the driver
			const actorOutput = await managerDriver.getForId({
				c,
				name: "", // TODO: The API doesn't provide the name, this may need to be resolved
				actorId: actor_id,
			});

			if (!actorOutput) {
				throw new ActorNotFound(actor_id);
			}

			// Transform ActorOutput to match ActorSchema
			// Note: Some fields are not available from the driver and need defaults
			const actor = {
				actor_id: actorOutput.actorId,
				name: actorOutput.name,
				key: actorOutput.key,
				namespace_id: "", // Not available from driver
				runner_name_selector: "", // Not available from driver
				create_ts: Date.now(), // Not available from driver
				connectable_ts: null,
				destroy_ts: null,
				sleep_ts: null,
				start_ts: null,
			};

			return c.json({ actor });
		});
	}

	// POST /actors
	{
		const route = createRoute({
			middleware: [cors],
			method: "post",
			path: "/actors",
			request: {
				body: {
					content: validateBody
						? {
								"application/json": {
									schema: ActorsCreateRequestSchema,
								},
							}
						: {},
				},
			},
			responses: buildOpenApiResponses(
				ActorsCreateResponseSchema,
				validateBody,
			),
		});

		router.openapi(route, async (c) => {
			const body = validateBody
				? await c.req.json<ActorsCreateRequest>()
				: await c.req.json();

			// Parse and validate the request body if validation is enabled
			if (validateBody) {
				ActorsCreateRequestSchema.parse(body);
			}

			// Create actor using the driver
			const actorOutput = await managerDriver.createActor({
				c,
				name: body.name,
				key: [body.key || crypto.randomUUID()], // Generate key if not provided, convert to ActorKey array
				input: body.input
					? cbor.decode(Buffer.from(body.input, "base64"))
					: undefined,
				region: undefined, // Not provided in the request schema
			});

			// Transform ActorOutput to match ActorSchema
			const actor = {
				actor_id: actorOutput.actorId,
				name: actorOutput.name,
				key: actorOutput.key,
				namespace_id: "", // Not available from driver
				runner_name_selector: body.runner_name_selector,
				create_ts: Date.now(),
				connectable_ts: null,
				destroy_ts: null,
				sleep_ts: null,
				start_ts: null,
			};

			return c.json({ actor });
		});
	}

	// TODO:
	// // DELETE /actors/{actor_id}
	// {
	// 	const route = createRoute({
	// 		middleware: [cors],
	// 		method: "delete",
	// 		path: "/actors/{actor_id}",
	// 		request: {
	// 			params: z.object({
	// 				actor_id: RivetIdSchema,
	// 			}),
	// 		},
	// 		responses: buildOpenApiResponses(
	// 			ActorsDeleteResponseSchema,
	// 			validateBody,
	// 		),
	// 	});
	//
	// 	router.openapi(route, async (c) => {
	// 		const { actor_id } = c.req.valid("param");
	//
	// 	});
	// }

	if (runConfig.inspector?.enabled) {
		if (!managerDriver.inspector) {
			throw new Unsupported("inspector");
		}
		router.route(
			"/inspect",
			new Hono<{ Variables: { inspector: any } }>()
				.use(corsMiddleware(runConfig.inspector.cors))
				.use(secureInspector(runConfig))
				.use((c, next) => {
					c.set("inspector", managerDriver.inspector!);
					return next();
				})
				.route("/", createManagerInspectorRouter()),
		);
	}

	// Error handling
	router.notFound(handleRouteNotFound);
	router.onError(handleRouteError);

	return { router: router as Hono, openapi: router };
}
