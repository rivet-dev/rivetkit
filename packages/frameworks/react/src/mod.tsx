import type { Client, ExtractActorsFromRegistry } from "@rivetkit/core/client";
import {
	type ActorOptions,
	type AnyActorRegistry,
	type CreateRivetKitOptions,
	createRivetKit as createVanillaRivetKit,
} from "@rivetkit/framework-base";
import { useStore } from "@tanstack/react-store";
import { useEffect } from "react";

export { createClient } from "@rivetkit/core/client";

export function createRivetKit<Registry extends AnyActorRegistry>(
	client: Client<Registry>,
	opts: CreateRivetKitOptions<Registry> = {},
) {
	const { getOrCreateActor } = createVanillaRivetKit<
		Registry,
		ExtractActorsFromRegistry<Registry>,
		keyof ExtractActorsFromRegistry<Registry>
	>(client, opts);

	/**
	 * Hook to connect to a actor and retrieve its state. Using this hook with the same options
	 * will return the same actor instance. This simplifies passing around the actor state in your components.
	 * It also provides a method to listen for events emitted by the actor.
	 * @param opts - Options for the actor, including its name, key, and parameters.
	 * @returns An object containing the actor's state and a method to listen for events.
	 */
	function useActor<
		ActorName extends keyof ExtractActorsFromRegistry<Registry>,
	>(opts: ActorOptions<Registry, ActorName>) {
		const { mount, setState, state } = getOrCreateActor<ActorName>(opts);

		useEffect(() => {
			setState((prev) => {
				prev.opts = {
					...opts,
					enabled: opts.enabled ?? true,
				};
				return prev;
			});
		}, [opts, setState]);

		useEffect(() => {
			return mount();
		}, [mount]);

		const actorState = useStore(state) || {};

		/**
		 * Hook to listen for events emitted by the actor.
		 * This hook allows you to subscribe to specific events emitted by the actor and execute a handler function
		 * when the event occurs.
		 * It uses the `useEffect` hook to set up the event listener when the actor connection is established.
		 * It cleans up the listener when the component unmounts or when the actor connection changes.
		 * @param eventName The name of the event to listen for.
		 * @param handler The function to call when the event is emitted.
		 */
		const useEvent = (
			eventName: string,
			// biome-ignore lint/suspicious/noExplicitAny: strong typing of handler is not supported yet
			handler: (...args: any[]) => void,
		) => {
			// biome-ignore lint/correctness/useExhaustiveDependencies: it's okay to not include all dependencies here
			useEffect(() => {
				if (!actorState?.connection) return;

				const connection = actorState.connection;
				return connection.on(eventName, handler);
			}, [actorState.connection, actorState.isConnected, eventName, handler]);
		};
		return {
			...actorState,
			useEvent,
		};
	}

	return {
		useActor,
	};
}
