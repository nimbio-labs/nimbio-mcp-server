# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**nimbio-mcp-server** is the official Model Context Protocol server for the Nimbio community API, published to npm as `@nimbio/mcp-server`. It lets an LLM agent — Claude, ChatGPT, Cursor, anything speaking MCP — read and operate a Nimbio community in natural language.

**It is a consumer of the npm SDK, not a client of the REST API.** Every call goes through `@nimbio/community-api`. This repo contains no HTTP, no auth, no retry policy, no ETag cache, no SSE parsing. That is the whole design: the SDK already has all of it, and a second implementation would be a second thing to keep at parity. See `nimbioCore/docs/mcp-server-plan.md` for the argument in full.

## Naming (keep them straight)

| Thing | Value |
|-------|-------|
| npm package | `@nimbio/mcp-server` |
| binary | `nimbio-mcp` |
| GitHub repo | `nimbio-labs/nimbio-mcp-server` |
| MCP server name | `nimbio` (what a host shows) |
| tool prefix | `nimbio_` |

## Tech Stack

- **Language**: TypeScript, ESM only, `node >= 18`
- **MCP**: `@modelcontextprotocol/sdk` — protocol revision **`2025-11-25`**, which is what the SDK negotiates. The published spec is further ahead (`2026-07-28`); see "Protocol" below.
- **API access**: `@nimbio/community-api` (the npm SDK) — the only runtime dependency besides the MCP SDK and zod
- **Transport**: stdio only. Credentials come from the environment, per the MCP authorization spec's guidance for stdio servers.
- **Build**: tsup · **Test**: vitest · **Lint**: eslint

## Architecture

```
src/
├── index.ts       # entry: load config, open one session, serve over stdio
├── config.ts      # environment -> Config; mode validation
├── session.ts     # one me() call -> scope, capabilities, test/live, host, writesPermitted
├── server.ts      # tool selection + registration, error boundary
├── confirm.ts     # human confirmation: elicitation, else a two-step token
├── errors.ts      # the API failures that mislead if passed through raw
├── format.ts      # result shaping; the TEST MODE / LIVE marker
├── redact.ts      # guest-link tokens and URLs
├── idempotency.ts # keys for the writes with a physical side effect
├── resources.ts   # nimbio:// reference material
├── prompts.ts     # four starting points
└── tools/
    ├── index.ts   # THE REGISTRY — single source of truth, order is deliberate
    ├── types.ts   # ToolDef
    └── *.ts       # tools, grouped by subject; `*-writes.ts` holds the writers
```

**`src/tools/index.ts` is the source of truth.** `surface.json` is generated from it, and nimbioCore's parity gate reads that. Adding a tool means adding it there.

## The rules that matter

These are design commitments, not preferences. Changing one is a decision, not a refactor.

1. **`read-only` is the default mode.** A fresh install reads everything and writes nothing.
2. **A live key registers zero write tools** without `NIMBIO_MCP_ALLOW_LIVE`. The failure mode of a careless install must be a server that reads.
3. **Confirmation is never an argument.** A `confirm: true` the model can set is not a gate. Use `ctx.confirm(...)`, which elicits from the human or issues a single-use token bound to a hash of the exact arguments.
4. **Reads and writes are separate tools.** A combined R/W tool carries `readOnlyHint: false` and so vanishes in read-only mode, taking its read half with it. This is why there are 54 tools and not 42.
5. **Guest-link `token` and `url` are redacted** unless the caller passes `reveal`. Each one opens a gate on its own.
6. **Every result names the mode and the host.** `NIMBIO_ENV` defaults to `prod`; a live key plus a forgotten variable is production, so it is never left implicit.
7. **A tool the key cannot use is not registered.** Filtering happens once at startup, off `me()`.

## Protocol

Written against MCP `2025-11-25` — what `@modelcontextprotocol/sdk` negotiates. The published spec is at `2026-07-28`, which drops the `initialize` session and adds `resultType: "input_required"` for mid-call input. Neither is on the stable SDK path yet, so:

- Nothing here depends on statelessness, so the eventual upgrade is a no-op.
- Confirmation uses `server.elicitInput()` (stable) with a two-step token fallback for clients that do not advertise `elicitation`. When MRTR lands, mechanism 1 becomes `input_required` and the fallback can be retired.

## Common commands

```bash
npm run check         # version guard + lint + typecheck + coverage — what CI runs
npm test              # vitest
npm run coverage      # with thresholds
npm run surface       # regenerate surface.json after changing the registry
npm run build         # tsup -> dist/

# Drive the built server over stdio against a real API (needs a key)
NIMBIO_API_KEY=nimbio_test_... NIMBIO_ENV=dev node scripts/smoke.mjs
NIMBIO_API_KEY=nimbio_test_... NIMBIO_ENV=dev NIMBIO_MCP_MODE=write \
  node scripts/confirm-check.mjs      # exercises the token fallback specifically
```

Dev fixture keys live in `nimbioCore/.dev-secrets/` — a test key for everyday work, and a live one kept solely for exercising the live-key guard. **Always pass `NIMBIO_ENV=dev`**: the default is `prod`, and a live key with a forgotten `NIMBIO_ENV` is production.

## Testing

- `test/tools.test.ts` — registry invariants: unique spec-legal names, deterministic order, honest annotations, and that exactly the irreversible tools confirm.
- `test/handlers.test.ts` — drives every handler against a stand-in SDK that answers any field access as both an empty object and a one-element array, so the per-row shaping inside each `.map()` runs. This is where a wrong field name shows up.
- `test/endpoints.test.ts` — derives the truth from the SDK's own endpoint registry: no tool may declare a path the SDK lacks, and no SDK operation may be unreachable. Catches drift in both directions.
- `test/confirm.test.ts`, `test/errors.test.ts`, `test/redaction.test.ts`, `test/session.test.ts` — the safety spine, tested directly rather than through tools.
- `test/surface.test.ts` — generates `surface.json` and fails when it is stale.

Coverage thresholds sit just under what the suite achieves. Branches is lower than the rest **on purpose**: most uncovered branches are optional-argument permutations, and enumerating them would raise the number without testing anything new.

## Releasing

1. Update `CHANGELOG.md`, `package.json` and `src/version.ts` — `npm run version:check` enforces all three agree.
2. Update `nimbioCore/changelogs/mcp-server.md` and `marketing-changelogs/mcp-server.md` (stamp `## In Progress` with the version and date).
3. `npm run surface` if the registry changed; commit `surface.json`.
4. `cd ~/Documents/nimbioCore && ./nimbio.sh sdk-parity --include mcp --check`
5. Tag `vX.Y.Z` and push the tag — `.github/workflows/publish.yml` publishes via npm Trusted Publishing (OIDC, no stored token).

**A release is gated on the SDK it needs being published first.** This package depends on a published `@nimbio/community-api`; a version bump there must reach npm before a release here can install.

## Related

- `nimbioCore/docs/mcp-server-plan.md` — the design, the decisions, and what the build changed about them
- `nimbioCore/scripts/mcp_coverage_allow.txt` — API operations deliberately not exposed, with reasons
- `nimbio-npm-community-api/` — the SDK this is built on; its `CLAUDE.md` covers the wire contract
