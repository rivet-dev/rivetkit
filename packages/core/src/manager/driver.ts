import type { Env, Hono, Context as HonoContext } from "hono";
import type { ActorKey, Encoding } from "@/actor/mod";
import type { RunConfig } from "@/mod";
import type { RegistryConfig } from "@/registry/config";

export type ManagerDriverBuilder = (
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
) => ManagerDriver;

export interface ManagerDriver {
	getForId(input: GetForIdInput): Promise<ActorOutput | undefined>;
	getWithKey(input: GetWithKeyInput): Promise<ActorOutput | undefined>;
	getOrCreateWithKey(input: GetOrCreateWithKeyInput): Promise<ActorOutput>;
	createActor(input: CreateInput): Promise<ActorOutput>;

	sendRequest(actorId: string, actorRequest: Request): Promise<Response>;
	openWebSocket(
		path: string,
		actorId: string,
		encoding: Encoding,
		params: unknown,
	): Promise<WebSocket>;
	proxyRequest(
		c: HonoContext,
		actorRequest: Request,
		actorId: string,
	): Promise<Response>;
	proxyWebSocket(
		c: HonoContext,
		path: string,
		actorId: string,
		encoding: Encoding,
		params: unknown,
		authData: unknown,
	): Promise<Response>;

	modifyManagerRouter?: (registryConfig: RegistryConfig, router: Hono) => void;

	// inspector?: ManagerInspector;
}
export interface GetForIdInput<E extends Env = any> {
	c?: HonoContext | undefined;
	actorId: string;
}

export interface GetWithKeyInput<E extends Env = any> {
	c?: HonoContext | undefined;
	name: string;
	key: ActorKey;
}

export interface GetOrCreateWithKeyInput<E extends Env = any> {
	c?: HonoContext | undefined;
	name: string;
	key: ActorKey;
	input?: unknown;
	region?: string;
}

export interface CreateInput<E extends Env = any> {
	c?: HonoContext | undefined;
	name: string;
	key: ActorKey;
	input?: unknown;
	region?: string;
}

export interface ActorOutput {
	actorId: string;
	name: string;
	key: ActorKey;
}
