// Scenario harness: exercises the pi-proxy extension in ONE scenario under the
// current runtime, then prints a single `RESULT {json}` line.
//
// The parent test sets USERPROFILE/HOME to a throwaway directory, so the
// extension writes/reads its `~/.pi/proxy.json` there instead of the real home.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import ext from "../index.ts";

const scenario = process.env.PI_PROXY_SCENARIO;
if (!scenario) throw new Error("PI_PROXY_SCENARIO is not set");

function listen(server) {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve(server.address().port));
	});
}

let proxyHits = 0;
const origin = createServer((_req, res) => {
	res.writeHead(200, { "content-type": "text/plain" });
	res.end("origin-direct");
});
// Serves as the proxy for both request forms: Bun forward-proxies (absolute-form
// request to `request`), undici's ProxyAgent tunnels http:// via CONNECT.
const proxyResponse = "via-fake-proxy";
const proxy = createServer((_req, res) => {
	proxyHits++;
	res.writeHead(200, { "content-type": "text/plain", "content-length": Buffer.byteLength(proxyResponse) });
	res.end(proxyResponse);
});
proxy.on("connect", (_req, clientSocket) => {
	proxyHits++;
	clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
	clientSocket.once("data", () => {
		clientSocket.end(
			`HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: ${Buffer.byteLength(proxyResponse)}\r\nconnection: close\r\n\r\n${proxyResponse}`,
		);
	});
});

const originPort = await listen(origin);
const proxyPort = await listen(proxy);

// Reserve a port, close it, and use it as a guaranteed-dead proxy address.
const placeholder = createServer(() => {});
const deadPort = await listen(placeholder);
await new Promise((resolve) => placeholder.close(resolve));

const proxyUrl = `http://127.0.0.1:${proxyPort}`;
const deadUrl = `http://127.0.0.1:${deadPort}`;
const originUrl = `http://127.0.0.1:${originPort}/`;
const unreachableUrl = "http://pi-proxy-test.invalid/";

const LOCAL_RULE = {
	match: "localhost,127.0.0.1,*.local,10.*,192.168.*",
	action: "direct",
};

const scenarios = {
	"direct-local": {
		config: { proxy: proxyUrl, enabled: true, mode: "proxy", rules: [LOCAL_RULE, { match: "*", action: "proxy" }] },
		target: originUrl,
	},
	"proxy-remote": {
		config: { proxy: proxyUrl, enabled: true, mode: "proxy", rules: [LOCAL_RULE, { match: "*", action: "proxy" }] },
		target: unreachableUrl,
	},
	fallback: {
		config: { proxy: proxyUrl, enabled: true, mode: "fallback", rules: [LOCAL_RULE, { match: "*", action: "fallback" }] },
		target: unreachableUrl,
	},
	disabled: {
		config: { proxy: proxyUrl, enabled: false, mode: "proxy", rules: [{ match: "*", action: "proxy" }] },
		target: unreachableUrl,
	},
	"proxy-honored": {
		config: { proxy: deadUrl, enabled: true, mode: "proxy", rules: [{ match: "*", action: "proxy" }] },
		target: originUrl,
	},
};

const current = scenarios[scenario];
if (!current) throw new Error(`unknown scenario: ${scenario}`);

const configDir = join(homedir(), ".pi");
mkdirSync(configDir, { recursive: true });
writeFileSync(join(configDir, "proxy.json"), JSON.stringify(current.config));

const commands = {};
ext({
	registerCommand(name, opts) {
		commands[name] = opts;
	},
	on() {},
});

let status;
let body;
let error;
try {
	const res = await fetch(current.target);
	status = res.status;
	body = await res.text();
} catch (err) {
	error = err instanceof Error ? err.message : String(err);
}

let stats = "";
await commands.proxy.handler("", {
	ui: {
		select: async () => "Show stats",
		notify: (message) => {
			stats = message;
		},
	},
});

origin.close();
proxy.close();

console.log(
	`RESULT ${JSON.stringify({
		scenario,
		runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`,
		status,
		body,
		error,
		proxyHits,
		stats,
	})}`,
);

// Keep-alive sockets from the proxy agent would otherwise hold the process open.
process.exit(0);
