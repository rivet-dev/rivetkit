import { Actor, type Rpc } from "actor-core";

// state managed by the actor
export interface State {
	messages: { username: string; message: string }[];
}

export default class ChatRoom extends Actor<State> {
	// initialize this._state
	_onInitialize() {
		return { messages: [] };
	}

	// receive an remote procedure call from the client
	sendMessage(
		_rpc: Rpc<ChatRoom>,
		username: string,
		message: string
	) {
		// save message to persistent storage
		this._state.messages.push({ username, message });

		// broadcast message to all clients
		this._broadcast("newMessage", username, message);
	}

	getHistory(_rpc: Rpc<ChatRoom>) {
		return this._state.messages;
	}
}
