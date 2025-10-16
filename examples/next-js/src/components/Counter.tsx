"use client";

import { createRivetKit } from "@rivetkit/next-js/client";
import type { registry } from "@/rivet/registry";
import { useState } from "react";
import styles from "./Counter.module.css";

export const { useActor } = createRivetKit<typeof registry>({
	endpoint: process.env.NEXT_PUBLIC_RIVET_ENDPOINT ?? "http://localhost:3000/api/rivet",
	namespace: process.env.NEXT_PUBLIC_RIVET_NAMESPACE,
	token: process.env.NEXT_PUBLIC_RIVET_TOKEN,
});

export function Counter() {
	const [count, setCount] = useState(0);
	const [counterName, setCounterName] = useState("test-counter");

	const counter = useActor({
		name: "counter",
		key: [counterName],
	});

	counter.useEvent("newCount", (x: number) => setCount(x));

	const increment = async () => {
		await counter.connection?.increment(1);
	};

	return (
		<div>
			<div className={styles.field}>
				<label htmlFor="counterName">Counter Name:</label>
				<input
					id="counterName"
					name="counterName"
					type="text"
					value={counterName}
					onChange={(e) => setCounterName(e.target.value)}
					placeholder="Counter name"
				/>
			</div>

			<div className={styles.counter}>
				<p>
					Counter: <span className={styles.counterValue}>{count}</span>
				</p>
			</div>
			<button className={styles.button} type="button" onClick={increment}>
				Increment
			</button>
		</div>
	);
}
