# pi-proxy

Smart proxy routing extension for [pi](https://github.com/nicobailon/pi-coding-agent). Rule-based direct/proxy/fallback per domain.

## How it works

Monkey-patches `globalThis.fetch` to route requests based on domain rules:

- **direct** — always connect directly, no proxy
- **proxy** — always use proxy
- **fallback** — try direct first, retry through proxy on network error

AI API calls (OpenAI, Anthropic, etc.) stay direct. Only web content fetching gets proxy fallback when network is unreachable.

Routes through the proxy differently per runtime: Node uses undici's `dispatcher` (`ProxyAgent`), Bun uses its native `proxy` fetch option (Bun ignores `dispatcher`).

## Install

```bash
# Clone to pi extensions directory
git clone https://github.com/haokanjiang/pi-proxy.git ~/.pi/agent/extensions/pi-proxy
cd ~/.pi/agent/extensions/pi-proxy && npm install
```

## Config

Create `~/.pi/proxy.json`:

```json
{
  "proxy": "http://127.0.0.1:7890",
  "enabled": true,
  "mode": "fallback",
  "rules": [
    { "match": "localhost,127.0.0.1,*.local,10.*,192.168.*", "action": "direct", "comment": "Local/intranet" },
    { "match": "api.openai.com,api.anthropic.com,generativelanguage.googleapis.com", "action": "direct", "comment": "AI APIs" },
    { "match": "my-relay.example.com", "action": "proxy", "comment": "Force proxy" },
    { "match": "*", "action": "fallback", "comment": "Try direct, proxy on failure" }
  ]
}
```

Rules are matched top-down, first match wins.

### Pattern syntax

| Pattern | Matches |
|---------|---------|
| `example.com` | Exact domain |
| `*.example.com` | All subdomains |
| `10.*` | IP prefix |
| `*` | Everything |

## Commands

| Command | Action |
|---------|--------|
| `/proxy` | Open settings menu |

Menu options:
- **Turn ON/OFF** — toggle proxy
- **Show stats** — request counters
- **Reload config** — hot-reload `proxy.json`
- **Show rules** — display current rules

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_PROXY_URL` | `http://127.0.0.1:7890` | Override proxy URL (takes precedence over config) |

## Development

```bash
npm ci
npm test          # node --test
bun run test:bun  # bun test
```

The suite spawns the harness under both Node and Bun against a fake origin and a fake proxy (handles both forward and CONNECT forms), asserting per-rule routing, fallback and the disabled passthrough on each runtime.

## License

MIT
