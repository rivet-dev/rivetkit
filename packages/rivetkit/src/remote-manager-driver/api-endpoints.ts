import { serializeActorKey } from "@/actor/keys";
import type { ClientConfig } from "@/client/client";
import type {
	ActorsCreateRequest,
	ActorsCreateResponse,
} from "@/manager-api/routes/actors-create";
import type { ActorsDeleteResponse } from "@/manager-api/routes/actors-delete";
import type { ActorsGetResponse } from "@/manager-api/routes/actors-get";
import type { ActorsGetByIdResponse } from "@/manager-api/routes/actors-get-by-id";
import type {
	ActorsGetOrCreateByIdRequest,
	ActorsGetOrCreateByIdResponse,
} from "@/manager-api/routes/actors-get-or-create-by-id";
import type { RivetId } from "@/manager-api/routes/common";
import { apiCall } from "./api-utils";

// MARK: Get actor
export async function getActor(
	config: ClientConfig,
	actorId: RivetId,
): Promise<ActorsGetResponse> {
	return apiCall<never, ActorsGetResponse>(
		config,
		"GET",
		`/actors/${encodeURIComponent(actorId)}`,
	);
}

// MARK: Get actor by id
export async function getActorById(
	config: ClientConfig,
	name: string,
	key: string[],
): Promise<ActorsGetByIdResponse> {
	const serializedKey = serializeActorKey(key);
	return apiCall<never, ActorsGetByIdResponse>(
		config,
		"GET",
		`/actors/by-id?name=${encodeURIComponent(name)}&key=${encodeURIComponent(serializedKey)}`,
	);
}

// MARK: Get or create actor by id
export async function getOrCreateActorById(
	config: ClientConfig,
	request: ActorsGetOrCreateByIdRequest,
): Promise<ActorsGetOrCreateByIdResponse> {
	return apiCall<ActorsGetOrCreateByIdRequest, ActorsGetOrCreateByIdResponse>(
		config,
		"PUT",
		`/actors/by-id`,
		request,
	);
}

// MARK: Create actor
export async function createActor(
	config: ClientConfig,
	request: ActorsCreateRequest,
): Promise<ActorsCreateResponse> {
	return apiCall<ActorsCreateRequest, ActorsCreateResponse>(
		config,
		"POST",
		`/actors`,
		request,
	);
}

// MARK: Destroy actor
export async function destroyActor(
	config: ClientConfig,
	actorId: RivetId,
): Promise<ActorsDeleteResponse> {
	return apiCall<never, ActorsDeleteResponse>(
		config,
		"DELETE",
		`/actors/${encodeURIComponent(actorId)}`,
	);
}
