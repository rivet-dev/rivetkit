import defaultConfig from "../../../vitest.base.ts";
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	...defaultConfig,
	test: {
		...defaultConfig.test,
		maxConcurrency: 1,
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
		},
	},
});
