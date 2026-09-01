import { describe, it, expect } from "vitest";
import { TOOLS } from "../src/tools/index.js";
import { isWrite } from "../src/tools/types.js";
import { selectTools, instructions } from "../src/server.js";
import type { Session } from "../src/session.js";
import type { Config } from "../src/config.js";

const ALL_CAPS = [
  "open", "gate_status", "key_statuses", "hold_opens", "webhooks", "members", "messages",
  "access_logs", "key_schedules", "key_usage", "change_logs", "homes", "short_codes",
  "guest_view_entry", "access_codes", "guest_links", "map", "open_notifications", "settings",
  "sense_lines", "nfc_tags", "access_code_mode",
];

const session = (over: Partial<Session> = {}): Session => ({
  scope: "community",
  environment: "dev",
  baseUrl: "https://api.nimbio.dev",
  testMode: true,
  capabilities: ALL_CAPS,
  communityId: "2590",
  keyName: "test",
  minuteLimit: 60,
  monthLimit: 1000,
  monthCount: 0,
  writesPermitted: true,
  writesWithheldReason: null,
  ...over,
});

const config = (over: Partial<Config> = {}): Config => ({
  apiKey: "k",
  environment: "dev",
  mode: "write",
  allowLive: false,
  allTools: false,
  ...over,
});

describe("the tool registry", () => {
  it("has unique, spec-legal names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect(n.startsWith("nimbio_")).toBe(true);
    }
  });

  it("is deterministically ordered", () => {
    // Clients cache the tool list and hosts key prompt caches on it; a list that
    // reshuffles between calls invalidates both.
    const a = selectTools(session(), config()).registered.map((t) => t.name);
    const b = selectTools(session(), config()).registered.map((t) => t.name);
    expect(a).toEqual(b);
  });

  it("gives every tool a title, a description and endpoints", () => {
    for (const t of TOOLS) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.description.length, t.name).toBeGreaterThan(40);
      expect(t.endpoints.length, t.name).toBeGreaterThan(0);
      for (const e of t.endpoints) {
        expect(e, t.name).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \/v1\//);
      }
    }
  });

  it("annotates writes honestly", () => {
    for (const t of TOOLS) {
      if (t.annotations.readOnlyHint) {
        // A read tool must not claim to destroy anything, and must never confirm.
        expect(t.annotations.destructiveHint, t.name).toBeUndefined();
        expect(t.confirm, t.name).toBeUndefined();
      } else {
        expect(t.annotations.destructiveHint, t.name).toBeTypeOf("boolean");
        expect(t.annotations.idempotentHint, t.name).toBeTypeOf("boolean");
      }
    }
  });

  it("confirms exactly the irreversible tools", () => {
    const gated = TOOLS.filter((t) => t.confirm).map((t) => t.name).sort();
    expect(gated).toEqual(
      [
        "nimbio_open_gate",
        "nimbio_open_my_gate",
        "nimbio_remove_home",
        "nimbio_replay_webhook",
        "nimbio_revoke_guest_link",
        "nimbio_send_message",
        "nimbio_set_access_code_mode",
        "nimbio_set_hold_open",
      ].sort(),
    );
    // Everything confirm-gated must also be a write; confirming a read is nonsense.
    for (const t of TOOLS.filter((t) => t.confirm)) expect(isWrite(t), t.name).toBe(true);
  });

  it("marks the gate-opening tools non-idempotent and destructive", () => {
    for (const name of ["nimbio_open_gate", "nimbio_open_my_gate"]) {
      const t = TOOLS.find((x) => x.name === name)!;
      expect(t.annotations.destructiveHint).toBe(true);
      expect(t.annotations.idempotentHint).toBe(false);
    }
  });
});

describe("tool selection", () => {
  it("registers no write tools in read-only mode", () => {
    const s = session({ writesPermitted: false, writesWithheldReason: "read-only" });
    const f = selectTools(s, config({ mode: "read-only" }));
    expect(f.registered.every((t) => !isWrite(t))).toBe(true);
    expect(f.withheldForMode.length).toBeGreaterThan(0);
  });

  it("registers no write tools for a live key without the opt-in", () => {
    const s = session({
      testMode: false,
      writesPermitted: false,
      writesWithheldReason: "NIMBIO_MCP_ALLOW_LIVE is not set",
    });
    const f = selectTools(s, config());
    expect(f.registered.some(isWrite)).toBe(false);
    expect(instructions(s, f)).toMatch(/NIMBIO_MCP_ALLOW_LIVE/);
  });

  it("hides tools the key has no capability for", () => {
    const f = selectTools(session({ capabilities: ["gate_status"] }), config());
    expect(f.registered.some((t) => t.name === "nimbio_list_members")).toBe(false);
    expect(f.withheldForCapability.some((t) => t.name === "nimbio_list_members")).toBe(true);
    // Tools needing no capability still register.
    expect(f.registered.some((t) => t.name === "nimbio_whoami")).toBe(true);
  });

  it("ignores capability filtering when NIMBIO_MCP_ALL_TOOLS is set", () => {
    const f = selectTools(session({ capabilities: [] }), config({ allTools: true }));
    expect(f.withheldForCapability).toHaveLength(0);
  });

  it("separates account-scoped tools from community ones", () => {
    const community = selectTools(session(), config()).registered.map((t) => t.name);
    expect(community).not.toContain("nimbio_my_keys");
    expect(community).not.toContain("nimbio_open_my_gate");

    const account = selectTools(session({ scope: "account", capabilities: ["open"] }), config())
      .registered.map((t) => t.name);
    expect(account).toContain("nimbio_my_keys");
    expect(account).toContain("nimbio_whoami");
    expect(account).not.toContain("nimbio_list_members");
  });

  it("tells the model plainly which mode it is in", () => {
    const live = instructions(session({ testMode: false }), selectTools(session(), config()));
    expect(live).toMatch(/LIVE/);
    expect(instructions(session(), selectTools(session(), config()))).toMatch(/TEST MODE/);
  });
});
