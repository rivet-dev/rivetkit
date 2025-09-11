import {
	type Actions,
	type ActorConfig,
	type ActorConfigInput,
	ActorConfigSchema,
	ActorTypes,
} from "./config";
import type { AnyDatabaseProvider } from "./database";
import { ActorDefinition } from "./definition";

export function actor<
	TState,
	TConnParams,
	TConnState,
	TVars,
	TInput,
	TAuthData,
	TDatabase extends AnyDatabaseProvider,
	TActions extends Actions<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	>,
>(
	input: ActorConfigInput<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase,
		TActions
	>,
): ActorDefinition<
	TState,
	TConnParams,
	TConnState,
	TVars,
	TInput,
	TAuthData,
	TDatabase,
	TActions
> {
	const config = ActorConfigSchema.parse(input) as ActorConfig<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	>;
	return new ActorDefinition(config);
}
export type { Encoding } from "@/actor/protocol/serde";
export type {
	UniversalErrorEvent,
	UniversalEvent,
	UniversalEventSource,
	UniversalMessageEvent,
} from "@/common/eventsource-interface";
export type { UpgradeWebSocketArgs } from "@/common/inline-websocket-adapter2";
export type {
	RivetCloseEvent,
	RivetEvent,
	RivetMessageEvent,
	UniversalWebSocket,
} from "@/common/websocket-interface";
export type { ActorKey } from "@/manager/protocol/query";
export type { ActionContext } from "./action";
export type * from "./config";
export type {
	Conn,
	ConnectionDriver,
	ConnectionStatus,
	generateConnId,
	generateConnToken,
} from "./connection";
export {
	CONNECTION_DRIVER_HTTP,
	CONNECTION_DRIVER_SSE,
	CONNECTION_DRIVER_WEBSOCKET,
} from "./connection";
export type { ActorContext } from "./context";
export type {
	ActionContextOf,
	ActorContextOf,
	ActorDefinition,
	AnyActorDefinition,
} from "./definition";
export { lookupInRegistry } from "./definition";
export { UserError, type UserErrorOptions } from "./errors";
export {
	createGenericConnDrivers,
	GenericConnGlobalState,
} from "./generic-conn-driver";
export type { AnyActorInstance } from "./instance";
export {
	type ActorRouter,
	createActorRouter,
	PATH_CONNECT_WEBSOCKET,
	PATH_RAW_WEBSOCKET_PREFIX,
} from "./router";
export {
	ALLOWED_PUBLIC_HEADERS,
	handleRawWebSocketHandler,
	handleWebSocketConnect,
} from "./router-endpoints";
