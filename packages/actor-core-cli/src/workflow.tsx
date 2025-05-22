import { $ } from "execa";
import { Box, render } from "ink";
import { Intro } from "./ui/Intro";
import { Logs, WorkflowDetails } from "./ui/Workflow";
import { withResolvers } from "./utils/mod";
import type React from "react";
import type { ReactNode } from "react";
import type Stream from "node:stream";

interface WorkflowResult {
	success: boolean;
	error?: unknown;
}

interface TaskMetadata {
	id: string;
	name?: string;
	parent: string | null;
	opts?: TaskOptions;
}

export type Option = {
	label: string;
	value: string;
};

export namespace WorkflowAction {
	export interface Progress {
		status: "running" | "done" | "error";
		meta: TaskMetadata;
		result?: unknown;
		error?: unknown;
		streams?: Stream.Readable[];
		__taskProgress: true;
	}

	export const progress = (
		meta: TaskMetadata,
		status: "running" | "done" | "error",
		res: {
			error?: unknown;
			result?: unknown;
			streams?: Stream.Readable[];
		} & TaskOptions = {},
	): Progress => ({
		status,
		meta,
		...res,
		__taskProgress: true,
	});

	export namespace Prompt {
		interface Base {
			meta: TaskMetadata;
			question: string;
			__taskPrompt: true;
		}
		export interface Select extends Base {
			opts: {
				type: "select";
				choices: Option[];
				defaultValue?: string;
				answer: string | null;
				onSubmit: (value: string) => void;
			};
		}

		export interface Confirm extends Base {
			opts: {
				type: "confirm";
				answer: boolean | null;
				onSubmit: (value: boolean) => void;
			};
		}

		export interface Text extends Base {
			opts: {
				type: "text";
				answer: string | null;
				placeholder?: string;
				defaultValue?: string;
				onSubmit: (value: string) => void;
				validate?: (value: string) => string | true;
			};
		}

		export type Any = Select | Confirm | Text;
		export type Type = Any["opts"]["type"];
		export type One<T extends Type> = T extends "select"
			? Select
			: T extends "confirm"
				? Confirm
				: T extends "text"
					? Text
					: undefined;
		export type Answer<T extends Type> = Exclude<
			One<T>["opts"]["answer"],
			null
		>;
	}

	export const prompt = <T extends Prompt.Type>(
		meta: TaskMetadata,
		question: string,
		opts: Prompt.One<T>["opts"],
	): Prompt.One<T> => {
		return {
			meta,
			question,
			opts,
			__taskPrompt: true,
		} as Prompt.One<T>;
	};

	export type Interface = Progress | Prompt.Any;

	export interface Hook {
		__taskHook: true;
		hook: "afterAll";
		fn: (opts: { tasks: Interface[]; logs: Log[] }) => void;
	}

	export const hook = (
		hook: "afterAll",
		fn: (opts: { tasks: Interface[]; logs: Log[] }) => void,
	): Hook => ({
		__taskHook: true,
		hook,
		fn,
	});

	export interface Log {
		__taskLog: true;
		type: "log" | "error" | "warn";
		message: ReactNode;
	}

	export const log = (message: Omit<Log, "__taskLog">): Log => ({
		__taskLog: true,
		...message,
	});

	export type All = Interface | Hook | Log;
}

type GenericReturnValue =
	// biome-ignore lint/suspicious/noExplicitAny: we don't know the return type of the user function
	| any
	| string
	| number
	// biome-ignore lint/suspicious/noConfusingVoidType: we don't know the return type of the user function
	| void;

type UserFnReturnType =
	| Exclude<
			GenericReturnValue,
			// biome-ignore lint/suspicious/noExplicitAny: excluding, as we want to keep the return type as generic as possible, but still validate it
			any
	  >
	| Promise<GenericReturnValue>
	| AsyncGenerator<
			| WorkflowAction.Interface
			| GenericReturnValue
			| Promise<GenericReturnValue>
	  >
	| Generator<
			| WorkflowAction.Interface
			| GenericReturnValue
			| Promise<GenericReturnValue>
	  >;

export interface Context {
	wait: (ms: number) => Promise<undefined>;
	task: <T extends UserFnReturnType>(
		name: string,
		taskFn: (ctx: Context) => T,
		opts?: TaskOptions,
	) => AsyncGenerator<
		WorkflowAction.All,
		T extends AsyncGenerator<
			// biome-ignore lint/suspicious/noExplicitAny: we don't know the return type of the user function
			any,
			infer G
		>
			? G
			: T
	>;
	attach: (...streams: (Stream.Readable | null)[]) => WorkflowAction.All;
	changeLabel: (label: string) => void;
	render: (children: React.ReactNode) => WorkflowAction.All;
	error: (error: string, opts?: WorkflowErrorOpts) => WorkflowError;
	warn: (message: ReactNode) => Generator<WorkflowAction.Log>;
	log: (message: ReactNode) => Generator<WorkflowAction.Log>;
	suspend: () => void;
	prompt: <T extends WorkflowAction.Prompt.Type>(
		question: string,
		opts: Omit<WorkflowAction.Prompt.One<T>["opts"], "answer" | "onSubmit"> & {
			type: T;
		},
	) => AsyncGenerator<
		WorkflowAction.Prompt.One<T>,
		WorkflowAction.Prompt.Answer<T>
	>;
	$: (
		...params: readonly [
			TemplateStringsArray,
			// biome-ignore lint/suspicious/noExplicitAny: execa does not expose the return type of the command
			...(readonly any[]),
		]
	) => AsyncGenerator<
		WorkflowAction.All,
		{ stdout: string; exitCode?: number }
	>;
}

interface TaskOptions {
	showLabel?: boolean;
	success?: ReactNode;
	quiet?: boolean;
}

interface RunnerToolbox {
	processTask: (task: WorkflowAction.All) => void;
}

let TASK_ID = 0;

function getTaskId() {
	return String(TASK_ID++);
}

export function workflow(
	title: string,
	workflowFn: (ctx: Context) => AsyncGenerator<WorkflowAction.All | undefined>,
	opts: TaskOptions = {},
) {
	let renderUtils: ReturnType<typeof render> | null = null;

	async function* runner<T extends UserFnReturnType>(
		meta: TaskMetadata,
		toolbox: RunnerToolbox,
		name: string,
		taskFn: (ctx: Context) => T,
		opts: TaskOptions = {},
	): AsyncGenerator<WorkflowAction.All, T> {
		const id = getTaskId();
		const p = WorkflowAction.progress.bind(null, { ...meta, id, name, opts });
		yield p("running");
		try {
			const output = taskFn(
				createContext({ ...meta, id, name, opts }, toolbox),
			);
			if (output instanceof Promise) {
				const result = await output;
				yield p("done", { result, ...opts });
				return result;
			}
			const result = yield* output;
			yield p("done", { result, ...opts });
			return result;
		} catch (error) {
			yield p("error", { error });
			// bail out
			throw null;
		}
	}

	function createContext(meta: TaskMetadata, toolbox: RunnerToolbox): Context {
		return {
			wait: (ms: number) =>
				new Promise<undefined>((resolve) => setTimeout(resolve, ms)),
			task: runner.bind(
				null,
				{
					...meta,
					parent: meta.id,
					name: "",
				},
				toolbox,
			) as Context["task"],
			render(children: React.ReactNode) {
				return WorkflowAction.hook("afterAll", ({ tasks, logs }) => {
					renderUtils?.rerender(
						<Box flexDirection="column">
							<Intro />
							<WorkflowDetails tasks={tasks} interactive />
							<Logs logs={logs} />
							{children}
						</Box>,
					);
				});
			},
			attach(...streams: (Stream.Readable | null)[]) {
				return WorkflowAction.progress(meta, "running", {
					streams: streams.filter((s) => s !== null) as Stream.Readable[],
				});
			},
			changeLabel: (label: string) => {
				toolbox.processTask(
					WorkflowAction.progress({ ...meta, name: label }, "running"),
				);
			},
			error(error, opts) {
				return new WorkflowError(error, opts);
			},
			log: function* (message) {
				yield WorkflowAction.log({ type: "log", message });
			},
			warn: function* (message) {
				yield WorkflowAction.log({ type: "warn", message });
			},
			suspend() {
				renderUtils?.unmount();
			},
			prompt: async function* <T extends WorkflowAction.Prompt.Type>(
				question: string,
				opts: Omit<WorkflowAction.Prompt.One<T>["opts"], "answer" | "onSubmit">,
			): AsyncGenerator<
				WorkflowAction.Prompt.One<T>,
				WorkflowAction.Prompt.Answer<T>
			> {
				const id = getTaskId();
				const { promise, resolve, reject } =
					withResolvers<WorkflowAction.Prompt.Answer<T>>();

				yield WorkflowAction.prompt<T>(
					{ ...meta, parent: meta.id, id, name: question },
					question,
					{
						answer: null,
						onSubmit: resolve,
						...opts,
					} as WorkflowAction.Prompt.One<T>["opts"],
				);

				const result = await promise;

				yield WorkflowAction.prompt<T>(
					{ ...meta, parent: meta.id, id, name: question },
					question,
					{
						answer: result,
						onSubmit: resolve,
						...opts,
					} as WorkflowAction.Prompt.One<T>["opts"],
				);

				return result;
			},
			// biome-ignore lint/correctness/useYield: <explanation>
			$: async function* (...opts) {
				// yield WorkflowAction.progress({ ...meta, name: opts }, "running");
				const result = await $(...opts);
				// yield WorkflowAction.progress({ ...meta, name: opts }, "done");
				return { stdout: result.stdout, exitCode: result.exitCode };
			},
		};
	}

	async function* workflowRunner({
		processTask,
	}: RunnerToolbox): AsyncGenerator<WorkflowAction.All, WorkflowResult> {
		// task <> parent
		const parentMap = new Map<string, string>();
		const id = getTaskId();
		try {
			yield WorkflowAction.progress(
				{ id, name: title, parent: null, opts },
				"running",
			);
			for await (const task of workflowFn(
				createContext({ id, name: title, parent: id }, { processTask }),
			)) {
				if (!task || typeof task !== "object") {
					continue;
				}

				if ("__taskProgress" in task) {
					const parent = task.meta?.parent || id;
					parentMap.set(task.meta.id, parent);
					// Propagate errors up the tree
					if (task.status === "error") {
						let parentTask = parentMap.get(task.meta.id);
						while (parentTask) {
							const grandParent = parentMap.get(parentTask);
							yield WorkflowAction.progress(
								{
									id: parentTask,
									parent: grandParent || null,
								},
								"error",
							);
							parentTask = grandParent;
						}
					}
					yield task;
				}

				if (
					"__taskHook" in task ||
					"__taskPrompt" in task ||
					"__taskLog" in task
				) {
					yield task;
				}
			}

			yield WorkflowAction.progress(
				{ name: title, parent: null, opts, id },
				"done",
			);
			return { success: true };
		} catch (error) {
			yield WorkflowAction.progress(
				{ name: title, parent: null, opts, id },
				"error",
				{
					error,
				},
			);
			return { success: false, error };
		}
	}

	return {
		title,
		async render() {
			const interactive = !process.env.CI;
			renderUtils = render(
				<Box flexDirection="column">
					<Intro />
					<WorkflowDetails tasks={[]} interactive={interactive} />
				</Box>,
			);

			const hooks = {
				afterAll: [] as WorkflowAction.Hook["fn"][],
			};
			const logs: WorkflowAction.Log[] = [];
			const tasks: WorkflowAction.Interface[] = [];

			function processTask(task: WorkflowAction.All) {
				if ("__taskLog" in task) {
					logs.push(task);
					return;
				}
				if ("__taskHook" in task) {
					hooks[task.hook].push(task.fn);
					return;
				}

				const index = tasks.findIndex((t) => t.meta.id === task.meta.id);
				if (index === -1 || !interactive) {
					tasks.push(task);
				} else {
					tasks[index] = { ...tasks[index], ...task };
				}

				renderUtils?.rerender(
					<Box flexDirection="column">
						<Intro />
						<WorkflowDetails tasks={tasks} interactive={interactive} />
						<Logs logs={logs} />
					</Box>,
				);
			}

			for await (const task of workflowRunner({ processTask })) {
				processTask(task);
			}

			for (const hook of hooks.afterAll) {
				hook({ tasks, logs });
			}

			const hadError = tasks.some(
				(task) => "__taskProgress" in task && task.status === "error",
			);

			if (hadError) {
				await renderUtils.waitUntilExit();
				renderUtils.unmount();
				process.exit(1);
			}
		},
	};
}

interface WorkflowErrorOpts {
	hint?: string;
}

export class WorkflowError extends Error {
	constructor(
		public description: string,
		public opts: WorkflowErrorOpts = {},
	) {
		super("Workflow failed");
	}
}
