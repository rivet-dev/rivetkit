import {
	type ActorConfig,
	type ActorConfigInput,
	createActorConfigSchema,
	type Rpcs,
} from "./config";
import { ActorInstance } from "./instance";

export type AnyActorDefinition = ActorDefinition<any, any, any, any>;

export class ActorDefinition<R extends Rpcs<S, CP, CS>, S, CP, CS> {
	#config: ActorConfig<S, CP, CS>;

	constructor(config: ActorConfig<S, CP, CS>) {
		this.#config = config;
	}

	instantiate(): ActorInstance<S, CP, CS> {
		return new ActorInstance(this.#config);
	}
}
