import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import * as cbor from "cbor-x";
import { Hono } from "hono";
import { cors as corsMiddleware } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { WSContext } from "hono/ws";
import invariant from "invariant";
import { z } from "zod";
import {
	ActorNotFound,
	FeatureNotImplemented,
	MissingActorHeader,
	Unsupported,
	WebSocketsNotEnabled,
} from "@/actor/errors";
import type { Encoding, Transport } from "@/client/mod";
import {
	handleRouteError,
	handleRouteNotFound,
	loggerMiddleware,
} from "@/common/router";
import { deconstructError, noopNext } from "@/common/utils";
import { HEADER_ACTOR_ID } from "@/driver-helpers/mod";
import type {
	TestInlineDriverCallRequest,
	TestInlineDriverCallResponse,
} from "@/driver-test-suite/test-inline-client-driver";
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
import type { UniversalWebSocket, UpgradeWebSocketArgs } from "@/mod";
import type { RegistryConfig } from "@/registry/config";
import type { RunConfig } from "@/registry/run-config";
import { promiseWithResolvers, stringifyError } from "@/utils";
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
				method: c.req.raw.method,
				headers: proxyHeaders,
				body: c.req.raw.body,
				signal: c.req.raw.signal,
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
				namespace_id: "default", // Assert default namespace
				runner_name_selector: "rivetkit", // Assert rivetkit runner
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
				namespace_id: "default", // Assert default namespace
				runner_name_selector: "rivetkit", // Assert rivetkit runner
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

			return c.body(cbor.encode(response));
		});

		router.get(".test/inline-driver/connect-websocket/*", async (c) => {
			const upgradeWebSocket = runConfig.getUpgradeWebSocket?.();
			invariant(upgradeWebSocket, "websockets not supported on this platform");

			return upgradeWebSocket(async (c: any) => {
				const {
					path,
					actorId,
					params: paramsRaw,
					encodingKind,
					transport,
				} = c.req.query() as {
					path: string;
					actorId: string;
					params?: string;
					encodingKind: Encoding;
					transport: Transport;
				};
				const params =
					paramsRaw !== undefined ? JSON.parse(paramsRaw) : undefined;

				logger().debug({
					msg: "received test inline driver websocket",
					actorId,
					params,
					encodingKind,
					transport,
					path: path,
				});

				// Connect to the actor using the inline client driver - this returns a Promise<WebSocket>
				const clientWsPromise = managerDriver.openWebSocket(
					path,
					actorId,
					encodingKind,
					params,
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
	}

	managerDriver.modifyManagerRouter?.(
		registryConfig,
		router as unknown as Hono,
	);

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
/**
 * Creates a WebSocket proxy for test endpoints that forwards messages between server and client WebSockets
 */
async function createTestWebSocketProxy(
	clientWsPromise: Promise<UniversalWebSocket>,
): Promise<UpgradeWebSocketArgs> {
	// Store a reference to the resolved WebSocket
	let clientWs: UniversalWebSocket | null = null;
	const {
		promise: serverWsPromise,
		resolve: serverWsResolve,
		reject: serverWsReject,
	} = promiseWithResolvers<WSContext>();
	try {
		// Resolve the client WebSocket promise
		logger().debug({ msg: "awaiting client websocket promise" });
		const ws = await clientWsPromise;
		clientWs = ws;
		logger().debug({
			msg: "client websocket promise resolved",
			constructor: ws?.constructor.name,
		});

		// Wait for ws to open
		await new Promise<void>((resolve, reject) => {
			const onOpen = () => {
				logger().debug({ msg: "test websocket connection to actor opened" });
				resolve();
			};
			const onError = (error: any) => {
				logger().error({ msg: "test websocket connection failed", error });
				reject(
					new Error(`Failed to open WebSocket: ${error.message || error}`),
				);
				serverWsReject();
			};

			ws.addEventListener("open", onOpen);

			ws.addEventListener("error", onError);

			ws.addEventListener("message", async (clientEvt: MessageEvent) => {
				const serverWs = await serverWsPromise;

				logger().debug({
					msg: `test websocket connection message from client`,
					dataType: typeof clientEvt.data,
					isBlob: clientEvt.data instanceof Blob,
					isArrayBuffer: clientEvt.data instanceof ArrayBuffer,
					dataConstructor: clientEvt.data?.constructor?.name,
					dataStr:
						typeof clientEvt.data === "string"
							? clientEvt.data.substring(0, 100)
							: undefined,
				});

				if (serverWs.readyState === 1) {
					// OPEN
					// Handle Blob data
					if (clientEvt.data instanceof Blob) {
						clientEvt.data
							.arrayBuffer()
							.then((buffer) => {
								logger().debug({
									msg: "converted client blob to arraybuffer, sending to server",
									bufferSize: buffer.byteLength,
								});
								serverWs.send(buffer as any);
							})
							.catch((error) => {
								logger().error({
									msg: "failed to convert blob to arraybuffer",
									error,
								});
							});
					} else {
						logger().debug({
							msg: "sending client data directly to server",
							dataType: typeof clientEvt.data,
							dataLength:
								typeof clientEvt.data === "string"
									? clientEvt.data.length
									: undefined,
						});
						serverWs.send(clientEvt.data as any);
					}
				}
			});

			ws.addEventListener("close", async (clientEvt: any) => {
				const serverWs = await serverWsPromise;

				logger().debug({
					msg: `test websocket connection closed`,
				});

				if (serverWs.readyState !== 3) {
					// Not CLOSED
					serverWs.close(clientEvt.code, clientEvt.reason);
				}
			});

			ws.addEventListener("error", async () => {
				const serverWs = await serverWsPromise;

				logger().debug({
					msg: `test websocket connection error`,
				});

				if (serverWs.readyState !== 3) {
					// Not CLOSED
					serverWs.close(1011, "Error in client websocket");
				}
			});
		});
	} catch (error) {
		logger().error({
			msg: `failed to establish client websocket connection`,
			error,
		});
		return {
			onOpen: (_evt, serverWs) => {
				serverWs.close(1011, "Failed to establish connection");
			},
			onMessage: () => {},
			onError: () => {},
			onClose: () => {},
		};
	}

	// Create WebSocket proxy handlers to relay messages between client and server
	return {
		onOpen: (_evt: any, serverWs: WSContext) => {
			logger().debug({
				msg: `test websocket connection from client opened`,
			});

			// Check WebSocket type
			logger().debug({
				msg: "clientWs info",
				constructor: clientWs.constructor.name,
				hasAddEventListener: typeof clientWs.addEventListener === "function",
				readyState: clientWs.readyState,
			});

			serverWsResolve(serverWs);
		},
		onMessage: (evt: { data: any }) => {
			logger().debug({
				msg: "received message from server",
				dataType: typeof evt.data,
				isBlob: evt.data instanceof Blob,
				isArrayBuffer: evt.data instanceof ArrayBuffer,
				dataConstructor: evt.data?.constructor?.name,
				dataStr:
					typeof evt.data === "string" ? evt.data.substring(0, 100) : undefined,
			});

			// Forward messages from server websocket to client websocket
			if (clientWs.readyState === 1) {
				// OPEN
				// Handle Blob data
				if (evt.data instanceof Blob) {
					evt.data
						.arrayBuffer()
						.then((buffer) => {
							logger().debug({
								msg: "converted blob to arraybuffer, sending",
								bufferSize: buffer.byteLength,
							});
							clientWs.send(buffer);
						})
						.catch((error) => {
							logger().error({
								msg: "failed to convert blob to arraybuffer",
								error,
							});
						});
				} else {
					logger().debug({
						msg: "sending data directly",
						dataType: typeof evt.data,
						dataLength:
							typeof evt.data === "string" ? evt.data.length : undefined,
					});
					clientWs.send(evt.data);
				}
			}
		},
		onClose: (
			event: {
				wasClean: boolean;
				code: number;
				reason: string;
			},
			serverWs: WSContext,
		) => {
			logger().debug({
				msg: `server websocket closed`,
				wasClean: event.wasClean,
				code: event.code,
				reason: event.reason,
			});

			// HACK: Close socket in order to fix bug with Cloudflare leaving WS in closing state
			// https://github.com/cloudflare/workerd/issues/2569
			serverWs.close(1000, "hack_force_close");

			// Close the client websocket when the server websocket closes
			if (
				clientWs &&
				clientWs.readyState !== clientWs.CLOSED &&
				clientWs.readyState !== clientWs.CLOSING
			) {
				// Don't pass code/message since this may affect how close events are triggered
				clientWs.close(1000, event.reason);
			}
		},
		onError: (error: unknown) => {
			logger().error({
				msg: `error in server websocket`,
				error,
			});

			// Close the client websocket on error
			if (
				clientWs &&
				clientWs.readyState !== clientWs.CLOSED &&
				clientWs.readyState !== clientWs.CLOSING
			) {
				clientWs.close(1011, "Error in server websocket");
			}

			serverWsReject();
		},
	};
}
