import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import * as cbor from "cbor-x";
import {
	Hono,
	type Context as HonoContext,
	type MiddlewareHandler,
	type Next,
} from "hono";
import { cors as corsMiddleware } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { streamSSE } from "hono/streaming";
import invariant from "invariant";
import { z } from "zod";
import { ActorNotFound, Unsupported } from "@/actor/errors";
import { serializeActorKey } from "@/actor/keys";
import type { Encoding, Transport } from "@/client/mod";
import {
	WS_PROTOCOL_ACTOR,
	WS_PROTOCOL_CONN_ID,
	WS_PROTOCOL_CONN_PARAMS,
	WS_PROTOCOL_CONN_TOKEN,
	WS_PROTOCOL_ENCODING,
	WS_PROTOCOL_PATH,
	WS_PROTOCOL_TRANSPORT,
} from "@/common/actor-router-consts";
import {
	handleRouteError,
	handleRouteNotFound,
	loggerMiddleware,
} from "@/common/router";
import { deconstructError, noopNext, stringifyError } from "@/common/utils";
import { type ActorDriver, HEADER_ACTOR_ID } from "@/driver-helpers/mod";
import type {
	TestInlineDriverCallRequest,
	TestInlineDriverCallResponse,
} from "@/driver-test-suite/test-inline-client-driver";
import { createManagerInspectorRouter } from "@/inspector/manager";
import { isInspectorEnabled, secureInspector } from "@/inspector/utils";
import {
	type ActorsCreateRequest,
	ActorsCreateRequestSchema,
	type ActorsCreateResponse,
	ActorsCreateResponseSchema,
	type ActorsGetOrCreateRequest,
	ActorsGetOrCreateRequestSchema,
	type ActorsGetOrCreateResponse,
	ActorsGetOrCreateResponseSchema,
	type ActorsListResponse,
	ActorsListResponseSchema,
	type Actor as ApiActor,
} from "@/manager-api/actors";
import { RivetIdSchema } from "@/manager-api/common";
import type { RegistryConfig } from "@/registry/config";
import type { RunConfig } from "@/registry/run-config";
import type { ActorOutput, ManagerDriver } from "./driver";
import { actorGateway, createTestWebSocketProxy } from "./gateway";
import { logger } from "./log";

function buildOpenApiResponses<T>(schema: T) {
	return {
		200: {
			description: "Success",
			content: {
				"application/json": {
					schema,
				},
			},
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
	serverlessActorDriverBuilder: (() => ActorDriver) | undefined,
): { router: Hono; openapi: OpenAPIHono } {
	const router = new OpenAPIHono({ strict: false }).basePath(
		runConfig.basePath,
	);

	router.use("*", loggerMiddleware(logger()));

	// HACK: Add Sec-WebSocket-Protocol header to fix KIT-339
	//
	// Some Deno WebSocket providers do not auto-set the protocol, which
	// will cause some WebSocket clients to fail
	router.use(
		"*",
		createMiddleware(async (c, next) => {
			const upgrade = c.req.header("upgrade");
			const isWebSocket = upgrade?.toLowerCase() === "websocket";
			const isGet = c.req.method === "GET";

			if (isGet && isWebSocket) {
				c.header("Sec-WebSocket-Protocol", "rivet");
			}

			await next();
		}),
	);

	if (serverlessActorDriverBuilder) {
		addServerlessRoutes(runConfig, serverlessActorDriverBuilder, router);
	} else {
		addManagerRoutes(registryConfig, runConfig, managerDriver, router);
	}

	// Error handling
	router.notFound(handleRouteNotFound);
	router.onError(handleRouteError);

	return { router: router as Hono, openapi: router };
}

function addServerlessRoutes(
	runConfig: RunConfig,
	serverlessActorDriverBuilder: (
		token: string | undefined,
		totalSlots: number | undefined,
	) => ActorDriver,
	router: OpenAPIHono,
) {
	// Apply CORS
	if (runConfig.cors) router.use("*", corsMiddleware(runConfig.cors));

	// GET /
	router.get("/", (c) => {
		return c.text(
			"This is a RivetKit server.\n\nLearn more at https://rivetkit.org",
		);
	});

	// Serverless start endpoint
	router.get("/start", async (c) => {
		const token = c.req.header("x-rivet-token");
		let totalSlots: number | undefined = parseInt(
			c.req.header("x-rivetkit-total-slots") as any,
		);
		if (isNaN(totalSlots)) totalSlots = undefined;

		const actorDriver = serverlessActorDriverBuilder(token, totalSlots);
		invariant(
			actorDriver.serverlessHandleStart,
			"missing serverlessHandleStart on ActorDriver",
		);
		return await actorDriver.serverlessHandleStart(c);
	});

	router.get("/health", (c) => {
		return c.text("ok");
	});
}

function addManagerRoutes(
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	managerDriver: ManagerDriver,
	router: OpenAPIHono,
) {
	// Serve inspector BEFORE the rest of the routes, since this has a special
	// CORS config that should take precedence for the `/inspector` path
	if (isInspectorEnabled(runConfig, "manager")) {
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

	// Apply CORS
	if (runConfig.cors) router.use("*", corsMiddleware(runConfig.cors));

	// Actor gateway
	router.use("*", actorGateway.bind(undefined, runConfig, managerDriver));

	// GET /
	router.get("/", (c) => {
		return c.text(
			"This is a RivetKit server.\n\nLearn more at https://rivetkit.org",
		);
	});

	// GET /actors
	{
		const route = createRoute({
			method: "get",
			path: "/actors",
			request: {
				query: z.object({
					name: z.string(),
					actor_ids: z.string().optional(),
					key: z.string().optional(),
				}),
			},
			responses: buildOpenApiResponses(ActorsListResponseSchema),
		});

		router.openapi(route, async (c) => {
			const { name, actor_ids, key } = c.req.valid("query");

			const actorIdsParsed = actor_ids
				? actor_ids
						.split(",")
						.map((id) => id.trim())
						.filter((id) => id.length > 0)
				: undefined;

			const actors: ActorOutput[] = [];

			if (actorIdsParsed) {
				if (actorIdsParsed.length > 32) {
					return c.json(
						{
							error: `Too many actor IDs. Maximum is 32, got ${actorIdsParsed.length}.`,
						},
						400,
					);
				}

				if (actorIdsParsed.length === 0) {
					return c.json<ActorsListResponse>({
						actors: [],
					});
				}

				for (const actorId of actorIdsParsed) {
					if (name) {
						const actorOutput = await managerDriver.getForId({
							c,
							name,
							actorId,
						});
						if (actorOutput) {
							actors.push(actorOutput);
						}
					}
				}
			} else if (key) {
				const actorOutput = await managerDriver.getWithKey({
					c,
					name,
					key: [key], // Convert string to ActorKey array
				});
				if (actorOutput) {
					actors.push(actorOutput);
				}
			}

			return c.json<ActorsListResponse>({
				actors: actors.map(createApiActor),
			});
		});
	}

	// PUT /actors
	{
		const route = createRoute({
			method: "put",
			path: "/actors",
			request: {
				body: {
					content: {
						"application/json": {
							schema: ActorsGetOrCreateRequestSchema,
						},
					},
				},
			},
			responses: buildOpenApiResponses(ActorsGetOrCreateResponseSchema),
		});

		router.openapi(route, async (c) => {
			const body = c.req.valid("json");

			// Check if actor already exists
			const existingActor = await managerDriver.getWithKey({
				c,
				name: body.name,
				key: [body.key], // Convert string to ActorKey array
			});

			if (existingActor) {
				return c.json<ActorsGetOrCreateResponse>({
					actor: createApiActor(existingActor),
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

			return c.json<ActorsGetOrCreateResponse>({
				actor: createApiActor(newActor),
				created: true,
			});
		});
	}

	// POST /actors
	{
		const route = createRoute({
			method: "post",
			path: "/actors",
			request: {
				body: {
					content: {
						"application/json": {
							schema: ActorsCreateRequestSchema,
						},
					},
				},
			},
			responses: buildOpenApiResponses(ActorsCreateResponseSchema),
		});

		router.openapi(route, async (c) => {
			const body = c.req.valid("json");

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
			const actor = createApiActor(actorOutput);

			return c.json<ActorsCreateResponse>({ actor });
		});
	}

	// TODO:
	// // DELETE /actors/{actor_id}
	// {
	// 	const route = createRoute({
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

	if (registryConfig.test.enabled) {
		// Add HTTP endpoint to test the inline client
		//
		// We have to do this in a router since this needs to run in the same server as the RivetKit registry. Some test contexts to not run in the same server.
		router.post(".test/inline-driver/call", async (c) => {
			// TODO: use openapi instead
			const buffer = await c.req.arrayBuffer();
			const { encoding, transport, method, args }: TestInlineDriverCallRequest =
				cbor.decode(new Uint8Array(buffer));

			logger().debug({
				msg: "received inline request",
				encoding,
				transport,
				method,
				args,
			});

			// Forward inline driver request
			let response: TestInlineDriverCallResponse<unknown>;
			try {
				const output = await ((managerDriver as any)[method] as any)(...args);
				response = { ok: output };
			} catch (rawErr) {
				const err = deconstructError(rawErr, logger(), {}, true);
				response = { err };
			}

			// TODO: Remove any
			return c.body(cbor.encode(response) as any);
		});

		router.get(".test/inline-driver/connect-websocket/*", async (c) => {
			const upgradeWebSocket = runConfig.getUpgradeWebSocket?.();
			invariant(upgradeWebSocket, "websockets not supported on this platform");

			return upgradeWebSocket(async (c: any) => {
				// Extract information from sec-websocket-protocol header
				const protocolHeader = c.req.header("sec-websocket-protocol") || "";
				const protocols = protocolHeader.split(/,\s*/);

				// Parse protocols to extract connection info
				let actorId = "";
				let encoding: Encoding = "bare";
				let transport: Transport = "websocket";
				let path = "";
				let params: unknown;
				let connId: string | undefined;
				let connToken: string | undefined;

				for (const protocol of protocols) {
					if (protocol.startsWith(WS_PROTOCOL_ACTOR)) {
						actorId = protocol.substring(WS_PROTOCOL_ACTOR.length);
					} else if (protocol.startsWith(WS_PROTOCOL_ENCODING)) {
						encoding = protocol.substring(
							WS_PROTOCOL_ENCODING.length,
						) as Encoding;
					} else if (protocol.startsWith(WS_PROTOCOL_TRANSPORT)) {
						transport = protocol.substring(
							WS_PROTOCOL_TRANSPORT.length,
						) as Transport;
					} else if (protocol.startsWith(WS_PROTOCOL_PATH)) {
						path = decodeURIComponent(
							protocol.substring(WS_PROTOCOL_PATH.length),
						);
					} else if (protocol.startsWith(WS_PROTOCOL_CONN_PARAMS)) {
						const paramsRaw = decodeURIComponent(
							protocol.substring(WS_PROTOCOL_CONN_PARAMS.length),
						);
						params = JSON.parse(paramsRaw);
					} else if (protocol.startsWith(WS_PROTOCOL_CONN_ID)) {
						connId = protocol.substring(WS_PROTOCOL_CONN_ID.length);
					} else if (protocol.startsWith(WS_PROTOCOL_CONN_TOKEN)) {
						connToken = protocol.substring(WS_PROTOCOL_CONN_TOKEN.length);
					}
				}

				logger().debug({
					msg: "received test inline driver websocket",
					actorId,
					params,
					encodingKind: encoding,
					transport,
					path: path,
				});

				// Connect to the actor using the inline client driver - this returns a Promise<WebSocket>
				const clientWsPromise = managerDriver.openWebSocket(
					path,
					actorId,
					encoding,
					params,
					connId,
					connToken,
				);

				return await createTestWebSocketProxy(clientWsPromise);
			})(c, noopNext());
		});

		router.all(".test/inline-driver/send-request/*", async (c) => {
			// Extract parameters from headers
			const actorId = c.req.header(HEADER_ACTOR_ID);

			if (!actorId) {
				return c.text("Missing required headers", 400);
			}

			// Extract the path after /send-request/
			const pathOnly =
				c.req.path.split("/.test/inline-driver/send-request/")[1] || "";

			// Include query string
			const url = new URL(c.req.url);
			const pathWithQuery = pathOnly + url.search;

			logger().debug({
				msg: "received test inline driver raw http",
				actorId,
				path: pathWithQuery,
				method: c.req.method,
			});

			try {
				// Forward the request using the inline client driver
				const response = await managerDriver.sendRequest(
					actorId,
					new Request(`http://actor/${pathWithQuery}`, {
						method: c.req.method,
						headers: c.req.raw.headers,
						body: c.req.raw.body,
						duplex: "half",
					}),
				);

				// Return the response directly
				return response;
			} catch (error) {
				logger().error({
					msg: "error in test inline raw http",
					error: stringifyError(error),
				});

				// Return error response
				const err = deconstructError(error, logger(), {}, true);
				return c.json(
					{
						error: {
							code: err.code,
							message: err.message,
							metadata: err.metadata,
						},
					},
					err.statusCode,
				);
			}
		});

		// Test endpoint to force disconnect a connection non-cleanly
		router.post("/.test/force-disconnect", async (c) => {
			const actorId = c.req.query("actor");
			const connId = c.req.query("conn");

			if (!actorId || !connId) {
				return c.text("Missing actor or conn query parameters", 400);
			}

			logger().debug({
				msg: "forcing unclean disconnect",
				actorId,
				connId,
			});

			try {
				// Send a special request to the actor to force disconnect the connection
				const response = await managerDriver.sendRequest(
					actorId,
					new Request(`http://actor/.test/force-disconnect?conn=${connId}`, {
						method: "POST",
					}),
				);

				if (!response.ok) {
					const text = await response.text();
					return c.text(
						`Failed to force disconnect: ${text}`,
						response.status as any,
					);
				}

				return c.json({ success: true });
			} catch (error) {
				logger().error({
					msg: "error forcing disconnect",
					error: stringifyError(error),
				});
				return c.text(`Error: ${error}`, 500);
			}
		});
	}

	router.get("/health", (c) => {
		return c.text("ok");
	});

	managerDriver.modifyManagerRouter?.(
		registryConfig,
		router as unknown as Hono,
	);
}

function createApiActor(actor: ActorOutput): ApiActor {
	return {
		actor_id: actor.actorId,
		name: actor.name,
		key: serializeActorKey(actor.key),
		namespace_id: "default", // Assert default namespace
		runner_name_selector: "rivetkit", // Assert rivetkit runner
		create_ts: Date.now(),
		connectable_ts: null,
		destroy_ts: null,
		sleep_ts: null,
		start_ts: null,
	};
}
