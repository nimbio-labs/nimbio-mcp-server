# @nimbio/mcp-server

Model Context Protocol server for the [Nimbio](https://nimbio.com) community API.
Exposes gates, members, guest access and access logs to LLM agents as MCP tools.

Built on [`@nimbio/community-api`](https://www.npmjs.com/package/@nimbio/community-api) —
it adds no HTTP, auth, retry or caching code of its own.

> **Status: in development.** Not yet published.

## Quick start

```jsonc
// Claude Desktop / Claude Code MCP config
{
  "mcpServers": {
    "nimbio": {
      "command": "npx",
      "args": ["-y", "@nimbio/mcp-server"],
      "env": { "NIMBIO_API_KEY": "nimbio_test_..." }
    }
  }
}
```

**Start with a `nimbio_test_*` key.** Test keys run the full pipeline — auth, rate
limiting, scope, validation — and then simulate the effect: no gate opens, no message
is sent. Everything below is safe to explore with one.

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `NIMBIO_API_KEY` | — | **Required.** Community- or account-scoped API key. |
| `NIMBIO_ENV` | `prod` | `prod`, `dev`, or `local`. |
| `NIMBIO_MCP_MODE` | `read-only` | `read-only`, `write`, or `unrestricted`. |
| `NIMBIO_MCP_ALLOW_LIVE` | unset | **Required** before a live (non-test) key may register write tools. |
| `NIMBIO_MCP_ALL_TOOLS` | unset | Register every tool regardless of the key's capabilities. |

### Safety defaults

- **`read-only` by default.** A fresh install reads everything and changes nothing.
- **Live keys need an explicit opt-in.** A `nimbio_live_*` key registers zero write tools
  unless `NIMBIO_MCP_ALLOW_LIVE` is set, so the failure mode of a careless install is a
  server that reads, not one that opens gates.
- **Every result is labelled** `TEST MODE` or `LIVE`, so a transcript never leaves you
  guessing whether a real gate was involved.
- **Tools you cannot use are not shown.** The tool list is filtered against the key's
  capabilities at startup, so the model never picks a tool destined to fail.

## Development

```bash
npm install
npm run typecheck && npm run lint && npm test
npm run build

# Drive the built server over stdio against a real API
NIMBIO_API_KEY=nimbio_test_... NIMBIO_ENV=dev node scripts/smoke.mjs
```

Design and rationale: `nimbioCore/docs/mcp-server-plan.md`.

## License

MIT
