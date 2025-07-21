// TODO: Fix imports for topology when needed
// This file is not currently being used and has been commented out to avoid type errors

/*
import type { ActorPeer } from "./actor-peer";
import type { ActorPeer } from "./actor-peer";
import type { RelayConn } from "./conn/mod";
import { publishActionToLeader } from "./node/action";
import { publishFetchToLeader } from "./node/fetch";
import { publishMessageToLeader } from "./node/message";
import { Node } from "./node/mod";
import { handleRawWebSocket } from "./router/raw-websocket";
import { serveSse } from "./router/sse";
import { serveWebSocket } from "./router/websocket";

export interface GlobalState {
	nodeId: string;
	// Actors currently running on this instance.
	actorPeers: Map<string, ActorPeer>;
	// Connections that are connected to this node.
	relayConns: Map<string, RelayConn>;
	// Resolvers for when a message is acknowledged by the peer.
	messageAckResolvers: Map<string, () => void>;
	// Resolvers for when an action response is received.
	actionResponseResolvers: Map<
		string,
		(result: { success: boolean; output?: unknown; error?: string }) => void
	>;
	// Resolvers for when a fetch response is received.
	fetchResponseResolvers: Map<string, (response: any) => void>;
	// Raw WebSocket connections mapped by WebSocket ID.
	rawWebSockets: Map<string, UniversalWebSocket>;
}

export class CoordinateTopology {
	public readonly clientDriver: ClientDriver;
	inlineClient: Client<Registry<any>>;
	public readonly router: Hono;

	constructor(registryConfig: RegistryConfig, runConfig: RunConfig) {
		const { actor: actorDriver, coordinate: CoordinateDriver } =
			runConfig.driver;
		if (!CoordinateDriver)
			throw new Error("config.driver.coordinate not defined.");

		// Allow usage of a lot of AbortSignals (which are EventEmitters)
		//events.defaultMaxListeners = 100_000;
		events.setMaxListeners(100_000);

		const globalState: GlobalState = {
			nodeId: crypto.randomUUID(),
			actorPeers: new Map(),
			relayConns: new Map(),
			messageAckResolvers: new Map(),
			actionResponseResolvers: new Map(),
			fetchResponseResolvers: new Map(),
			rawWebSockets: new Map(),
		};

		const node = new Node(CoordinateDriver, globalState);
		node.start();

		// Build router
		const router = new Hono();

		// Share connection handlers for both routers
		const connectionHandlers: ConnectionHandlers = {
			onConnectWebSocket: async (
				opts: ConnectWebSocketOpts,
			): Promise<ConnectWebSocketOutput> => {
				return await serveWebSocket(
					registryConfig,
					runConfig,
					actorDriver,
					this.inlineClient,
					CoordinateDriver,
					globalState,
					opts.actorId,
					opts,
				);
			},
			onConnectSse: async (opts: ConnectSseOpts): Promise<ConnectSseOutput> => {
				return await serveSse(
					registryConfig,
					runConfig,
					actorDriver,
					this.inlineClient,
					CoordinateDriver,
					globalState,
					opts.actorId,
					opts,
				);
			},
			onAction: async (opts: ActionOpts): Promise<ActionOutput> => {
				return await publishActionToLeader(
					registryConfig,
					runConfig,
					CoordinateDriver,
					actorDriver,
					this.inlineClient,
					globalState,
					opts,
				);
			},
			onConnMessage: async (opts: ConnsMessageOpts): Promise<void> => {
				await publishMessageToLeader(
					registryConfig,
					runConfig,
					CoordinateDriver,
					globalState,
					opts.actorId,
					{
						b: {
							lm: {
								ai: opts.actorId,
								ci: opts.connId,
								ct: opts.connToken,
								m: opts.message,
							},
						},
					},
					opts.req?.raw.signal,
				);
			},
			onFetch: async (opts: FetchOpts): Promise<Response> => {
				return await publishFetchToLeader(
					registryConfig,
					runConfig,
					CoordinateDriver,
					actorDriver,
					this.inlineClient,
					globalState,
					opts,
				);
			},
			onWebSocket: async (opts: WebSocketOpts): Promise<void> => {
				await handleRawWebSocket(
					registryConfig,
					runConfig,
					actorDriver,
					this.inlineClient,
					CoordinateDriver,
					globalState,
					opts,
				);
			},
		};

		const routingHandler: ConnRoutingHandler = {
			inline: { handlers: connectionHandlers },
		};

		// Create driver
		const managerDriver = runConfig.driver.manager;
		invariant(managerDriver, "missing manager driver");
		this.clientDriver = createInlineClientDriver(managerDriver, routingHandler);
		this.inlineClient = createClientWithDriver(this.clientDriver);

		// Build manager router
		const { router: managerRouter } = createManagerRouter(
			registryConfig,
			runConfig,
			this.clientDriver,
			{
				routingHandler,
				// onConnectInspector: () => {
				// 	throw new errors.Unsupported("inspect");
				// },
			},
		);

		router.route("/", managerRouter);

		this.router = router;
	}
}
*/
