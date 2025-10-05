import { registry } from "./registry";

registry.start({
	runnerKind: "serverless",
	runEngine: true,
	autoConfigureServerless: true,
});
