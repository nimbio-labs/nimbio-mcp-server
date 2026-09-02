# @nimbio/mcp-server

Model Context Protocol server for the [Nimbio](https://nimbio.com) community API.
Exposes gates, members, guest access and access logs to LLM agents as MCP tools.

Built on [`@nimbio/community-api`](https://www.npmjs.com/package/@nimbio/community-api) —
it adds no HTTP, auth, retry or caching code of its own.

> **Status:** built and tested, awaiting first publish. Requires
> `@nimbio/community-api` 0.7.0, which is not on npm yet.

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

## What it can do

54 tools, grouped the way a community manager thinks rather than the way the REST
endpoints are organised:

| Area | Examples |
|------|----------|
| Orientation | who this key is, what the community looks like, which features are on |
| Gates | live status, the roster and map, opening one, hold opens and their schedules |
| People | the roster, keys and access schedules, adding, approving, granting and revoking |
| Guests | guest links, access codes and their entry mode, GuestView Entry, short codes |
| Audit | who opened what, whether the gate physically moved, who changed the rules, usage reports |
| Config & hardware | settings, homes, sense lines, NFC tags, geofences |
| Plumbing | webhooks, delivery inspection and replay, broadcasts, your own alert settings |

Plus four resources the agent can read directly — including the schedule rules that
catch people out — and four prompts to start from.

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
- **Irreversible tools ask a human first.** Opening a gate, revoking a guest link, removing a
  home, and switching the community's access-code system (which deletes every existing code)
  all render their consequence and wait for confirmation. `unrestricted` mode skips that
  step entirely — use it only where a person is already approving each call.

## Development

```bash
npm install
npm run typecheck && npm run lint && npm test
npm run build

# Drive the built server over stdio against a real API
NIMBIO_API_KEY=nimbio_test_... NIMBIO_ENV=dev node scripts/smoke.mjs
```

```bash
npm run check    # what CI runs: version guard, lint, types, coverage
npm run surface  # regenerate surface.json after changing the tool registry
```

Design and rationale: `nimbioCore/docs/mcp-server-plan.md`. Repo conventions and
the rules that are design commitments rather than preferences: `CLAUDE.md`.

## License

MIT
