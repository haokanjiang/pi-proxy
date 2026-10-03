// Runs the scenario harness under both Node and Bun and asserts proxy routing.
//
// Node must keep its original behaviour: proxy requests go through undici's
// `dispatcher` (verified by `proxy-honored`), and fallback still fires on
// Node-style network errors (verified by `fallback`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const harness = join(root, "tests", "harness.mjs");

const runtimes = [
	{ name: "node", cmd: process.env.PI_PROXY_NODE ?? "node" },
	{ name: "bun", cmd: process.env.PI_PROXY_BUN ?? "bun" },
];

const expectations = {
	// Local/intranet rule → direct, proxy server untouched.
	"direct-local": { status: 200, body: "origin-direct", proxyHits: 0, stats: "direct: 1" },
	// Anything else → through the configured proxy (target host never resolves directly).
	"proxy-remote": { status: 200, body: "via-fake-proxy", proxyHits: 1, stats: "proxy: 1" },
	// Direct attempt fails, retry through the proxy succeeds.
	fallback: { status: 200, body: "via-fake-proxy", proxyHits: 1, stats: "fallback: 1 (hit: 1)" },
	// Disabled → plain passthrough, no proxy, no counters.
	disabled: { failed: true, proxyHits: 0, stats: "direct: 0 | proxy: 0 | fallback: 0 (hit: 0)" },
	// Dead proxy + a target that works directly: must fail, proving the proxy
	// is actually honoured (Bun ignores `dispatcher`; Node ignores `proxy`).
	"proxy-honored": { failed: true, proxyHits: 0, stats: "proxy: 1" },
};

function probe(cmd) {
	const res = spawnSync(cmd, ["--version"], { encoding: "utf8" });
	return res.status === 0;
}

function runScenario(cmd, scenario) {
	const home = mkdtempSync(join(tmpdir(), `pi-proxy-${scenario}-`));
	const res = spawnSync(cmd, [harness], {
		env: { ...process.env, PI_PROXY_SCENARIO: scenario, USERPROFILE: home, HOME: home },
		encoding: "utf8",
		timeout: 60_000,
	});
	if (res.error) throw res.error;
	const line = res.stdout.split(/\r?\n/).find((entry) => entry.startsWith("RESULT "));
	if (!line) {
		throw new Error(`${cmd}/${scenario}: no RESULT line (exit ${res.status})\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
	}
	return JSON.parse(line.slice("RESULT ".length));
}

function assertScenario(runtime, scenario, result) {
	assert.ok(
		result.runtime.startsWith(`${runtime} `),
		`expected ${runtime}, harness reported ${result.runtime}`,
	);
	const expected = expectations[scenario];
	if (expected.failed) {
		assert.ok(result.error, `expected a fetch failure, got status ${result.status} body ${result.body}`);
	} else {
		assert.equal(result.error, undefined);
		assert.equal(result.status, expected.status);
		assert.equal(result.body, expected.body);
	}
	assert.equal(result.proxyHits, expected.proxyHits);
	assert.ok(
		result.stats.includes(expected.stats),
		`stats "${result.stats}" should contain "${expected.stats}"`,
	);
}

for (const runtime of runtimes) {
	const available = probe(runtime.cmd);
	for (const scenario of Object.keys(expectations)) {
		test(`${runtime.name}: ${scenario}`, { skip: available ? false : `${runtime.name} not on PATH` }, () => {
			const result = runScenario(runtime.cmd, scenario);
			assertScenario(runtime.name, scenario, result);
		});
	}
}
