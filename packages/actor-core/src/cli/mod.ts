#!/usr/bin/env node

if (require.main !== module) {
	throw new Error("This script must be run directly");
}
// https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
// Borrowed from tsc :)
const colours = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",
	underscore: "\x1b[4m",
	blink: "\x1b[5m",
	reverse: "\x1b[7m",
	hidden: "\x1b[8m",
	fg: {
		black: "\x1b[30m",
		red: "\x1b[31m",
		green: "\x1b[32m",
		yellow: "\x1b[33m",
		blue: "\x1b[34m",
		magenta: "\x1b[35m",
		cyan: "\x1b[36m",
		white: "\x1b[37m",
		crimson: "\x1b[38m", // Scarlet
	},

	bg: {
		black: "\x1b[40m",
		red: "\x1b[41m",
		green: "\x1b[42m",
		yellow: "\x1b[43m",
		blue: "\x1b[44m",
		magenta: "\x1b[45m",
		cyan: "\x1b[46m",
		white: "\x1b[47m",
		crimson: "\x1b[48m",
	},
};

console.log();

const msg =
	"                This is not the actor-core command you are looking for                ";

console.log(colours.bg.red + " ".repeat(msg.length) + colours.reset);

console.log(colours.bg.red + colours.fg.white + msg + colours.reset);

console.log(colours.bg.red + " ".repeat(msg.length) + colours.reset);

console.log();

console.log(
	`To get access to the ActorCore CLI, ${colours.fg.red}@actor-core/cli${colours.reset}, from the command line either:\n`,
);

console.log(
	`- Use ${colours.bright}npm install @actor-core/cli${colours.reset} to first add CLI to your project ${colours.bright}before${colours.reset} using npx`,
);

console.log(
	`- Use ${colours.bright}yarn${colours.reset} to avoid accidentally running code from un-installed packages`,
);

process.exitCode = 1;
