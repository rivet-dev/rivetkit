import { registry } from "./registry";

registry.start({
	runnerKind: "serverless",
	autoConfigureServerless: { url: "http://localhost:8080" },
	endpoint: "http://localhost:6420",
});
