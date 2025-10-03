import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	root: "src/frontend",
	build: {
		outDir: "../../dist/public",
	},
	envDir: ".",
	server: {
		port: 5173,
	},
});
