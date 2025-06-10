import type { WorkerKey } from "@/common/utils";
import type { ManagerInspector } from "@/inspector/manager";
import type { Env, Context as HonoContext, HonoRequest } from "hono";

export interface ManagerDriver {
	getForId(input: GetForIdInput): Promise<WorkerOutput | undefined>;
	getWithKey(input: GetWithKeyInput): Promise<WorkerOutput | undefined>;
	getOrCreateWithKey(input: GetOrCreateWithKeyInput): Promise<WorkerOutput>;
	createWorker(input: CreateInput): Promise<WorkerOutput>;

	inspector?: ManagerInspector;
}
export interface GetForIdInput<E extends Env = any> {
	req?: HonoRequest | undefined;
	workerId: string;
}

export interface GetWithKeyInput<E extends Env = any> {
	req?: HonoRequest | undefined;
	name: string;
	key: WorkerKey;
}

export interface GetOrCreateWithKeyInput<E extends Env = any> {
	req?: HonoRequest | undefined;
	name: string;
	key: WorkerKey;
	input?: unknown;
	region?: string;
}

export interface CreateInput<E extends Env = any> {
	req?: HonoRequest | undefined;
	name: string;
	key: WorkerKey;
	input?: unknown;
	region?: string;
}

export interface WorkerOutput {
	workerId: string;
	name: string;
	key: WorkerKey;
	meta?: unknown;
}
