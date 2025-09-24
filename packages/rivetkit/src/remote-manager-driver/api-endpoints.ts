import { serializeActorKey } from "@/actor/keys";
import type { ClientConfig } from "@/client/client";
import type {
	ActorsCreateRequest,
	ActorsCreateResponse,
	ActorsDeleteResponse,
	ActorsGetOrCreateRequest,
	ActorsGetOrCreateResponse,
	ActorsListResponse,
} from "@/manager-api/actors";
import type { RivetId } from "@/manager-api/common";
import { apiCall } from "./api-utils";

// MARK: Get actor
export async function getActor(
	config: ClientConfig,
	name: string,
	actorId: RivetId,
): Promise<ActorsListResponse> {
	return apiCall<never, ActorsListResponse>(
		config,
		"GET",
		`/actors?name=${name}&actor_ids=${encodeURIComponent(actorId)}`,
	);
}

// MARK: Get actor by id
export async function getActorByKey(
	config: ClientConfig,
	name: string,
	key: string[],
): Promise<ActorsListResponse> {
	const serializedKey = serializeActorKey(key);
	return apiCall<never, ActorsListResponse>(
		config,
		"GET",
		`/actors?name=${encodeURIComponent(name)}&key=${encodeURIComponent(serializedKey)}`,
	);
}

// MARK: Get or create actor by id
export async function getOrCreateActor(
	config: ClientConfig,
	request: ActorsGetOrCreateRequest,
): Promise<ActorsGetOrCreateResponse> {
	return apiCall<ActorsGetOrCreateRequest, ActorsGetOrCreateResponse>(
		config,
		"PUT",
		`/actors`,
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
