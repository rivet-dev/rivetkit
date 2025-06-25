import { actor } from "@rivetkit/core";

export interface State {
	initialInput?: unknown;
	onCreateInput?: unknown;
}

// Test actor that can capture input during creation
export const inputActor = actor({
	onAuth: () => {},
	createState: (c, { input }): State => {
		return {
			initialInput: input,
			onCreateInput: undefined,
		};
	},

	onCreate: (c, { input }) => {
		c.state.onCreateInput = input;
	},

	actions: {
		getInputs: (c) => {
			return {
				initialInput: c.state.initialInput,
				onCreateInput: c.state.onCreateInput,
			};
		},
	},
});

