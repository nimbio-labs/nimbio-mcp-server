# Changelog

All notable changes to `@nimbio/mcp-server` are documented here. This project
adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-01

Single-entry access codes, and the first release intended for npm. Requires
`@nimbio/community-api` 0.7.0.

### Added

- **`nimbio_access_code_mode`** — reports which of the two access-code systems
  the community runs (`per_member`, the default, where a visitor picks a
  resident and types that resident's code; or `single_entry`, where every
  member carries a unique 3-letter preamble and the visitor types preamble plus
  code, e.g. `ESM481502`). It also returns a dry run of switching: how many
  codes a flip would delete, how many members it affects, and how many would be
  assigned a preamble.
- **`nimbio_set_access_code_mode`** — switches between them, confirm-gated.
  **Switching is destructive in both directions**: it deletes *every* access
  code in the community — this key's, other integrations', and residents' own —
  because a code's meaning changes with the mode. The flip preview is rendered
  into the confirmation text before anything fires, and the underlying API's
  own `confirm: true` handshake is only sent after a human agreed, so that
  second gate is never left for the model to satisfy on its own.
- Access-code listings now carry the owner's preamble and the masked entry
  code; creating a code returns the full entry code once.

## [0.1.0] - 2026-08-28

Initial build. **Never published to npm** — the version line starts on the
registry at 0.2.0.

### Added

- An MCP server over the Nimbio community API, built on
  `@nimbio/community-api` rather than on the REST API directly, exposing 52
  tools, 4 resources and 4 prompts over stdio.
- **Safety defaults.** `NIMBIO_MCP_MODE` is `read-only` unless set, so a fresh
  install reads everything and changes nothing. A live (`nimbio_live_*`) key
  registers zero write tools without `NIMBIO_MCP_ALLOW_LIVE`, so the failure
  mode of a careless install is a server that reads rather than one that opens
  gates. Every result is labelled `TEST MODE` or `LIVE`, and names the API host
  it is talking to.
- **Confirmation before anything irreversible** — opening a gate, holding one
  open, revoking a guest link, removing a home, replaying webhook deliveries,
  messaging every member. Obtained by elicitation where the client supports it,
  and otherwise by a single-use 60-second token bound to the exact arguments.
  Never a `confirm` argument the model can set for itself.
- **Guest-link tokens and URLs are redacted** unless `reveal: true` is passed,
  because each one opens the gate on its own with no account or login.
- **Errors that mislead are normalized**: a `504 did_not_open` explains that
  the gate may have physically fired anyway and that the idempotency token is
  deliberately not released; `scan_required` gets one explanation whether it
  arrived as 409 or 403; a capability 403 names the missing capability and says
  no retry will help.
- Opens carry an automatically generated idempotency key, so a retry replays
  the first result rather than opening a gate twice.
- Tools are filtered by the key's capabilities and scope at startup, so the
  model never sees a tool destined to fail.
