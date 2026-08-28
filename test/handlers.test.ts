import { describe, it, expect } from "vitest";
import { TOOLS } from "../src/tools/index.js";
import type { ToolContext } from "../src/tools/types.js";
import type { Session } from "../src/session.js";
import type { Config } from "../src/config.js";

/**
 * Drive every tool handler against a stand-in SDK.
 *
 * This is not testing the API — it is testing the shaping code in each handler:
 * that it reads fields that exist, survives an empty response, and produces a
 * well-formed result. A handler reaching for a field the SDK does not return
 * throws here rather than in front of a user.
 *
 * The stand-in answers any property access with a value that behaves like an
 * empty array *and* like an object, so a handler can `.map()` it, take its
 * `.length`, spread it, or reach through it without special-casing.
 */
/**
 * Array behaviour the stand-in passes through. Everything else — including
 * names that happen to exist on Array.prototype, such as `keys`, `values` and
 * `entries`, all of which are real field names in these payloads — is treated
 * as data and answered with another chameleon.
 */
const ARRAY_BEHAVIOUR = new Set([
  "length", "map", "filter", "slice", "forEach", "reduce", "join", "concat",
  "some", "every", "flatMap", "flat", "sort", "reverse", "indexOf", "includes",
  "at", "toString", "constructor",
]);

/**
 * How deep a nested collection is populated. Every collection yields exactly
 * one row, so the per-row shaping code inside each `.map()` actually runs —
 * that is where a wrong field name hides.
 */
const MAX_DEPTH = 3;

function fill(target: unknown[], depth: number): void {
  if (target.length === 0 && depth < MAX_DEPTH) target.push(chameleon(depth + 1));
}

function chameleon(depth = 0): never {
  const target: unknown[] = [];
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === Symbol.iterator) {
        fill(t, depth);
        return Reflect.get(t, prop, receiver);
      }
      if (prop === Symbol.toPrimitive) return () => "";
      // Must look like neither a promise nor a custom serializer.
      if (prop === "then" || prop === "toJSON") return undefined;
      if (typeof prop === "string" && (ARRAY_BEHAVIOUR.has(prop) || /^\d+$/.test(prop))) {
        fill(t, depth);
        return Reflect.get(t, prop, receiver);
      }
      return chameleon(depth + 1);
    },
  }) as never;
}

function stubClient() {
  const calls: string[] = [];
  const surface = (prefix: string) =>
    new Proxy(
      {},
      {
        get(_t, prop: string) {
          return async (...args: unknown[]) => {
            calls.push(`${prefix}.${prop}(${args.length})`);
            return chameleon();
          };
        },
      },
    );
  return {
    calls,
    client: {
      me: async () => chameleon(),
      community: surface("community"),
      account: surface("account"),
    } as never,
  };
}

const session: Session = {
  scope: "community",
  environment: "dev",
  baseUrl: "https://api.nimbio.dev",
  testMode: true,
  capabilities: ["open", "members", "settings", "gate_status"],
  communityId: "2590",
  keyName: "k",
  minuteLimit: 60,
  monthLimit: 1000,
  monthCount: 1,
  writesPermitted: true,
  writesWithheldReason: null,
};

const config: Config = {
  apiKey: "k",
  environment: "dev",
  mode: "write",
  allowLive: false,
  allTools: true,
  ...{},
};

/** Arguments that satisfy each tool's required fields and reach its main path. */
const ARGS: Record<string, Record<string, unknown>[]> = {
  nimbio_open_gate: [{ latch_id: "L1" }],
  nimbio_open_my_gate: [{ key_id: "K1", latch_id: "L1" }],
  nimbio_set_hold_open: [
    { latch_id: "L1", action: "hold" },
    { latch_id: "L1", action: "release" },
    { latch_id: "L1", action: "suspend_schedules", until: "2026-09-01T00:00:00Z" },
    { latch_id: "L1", action: "suspend_schedules" }, // missing `until` -> argument error
    { latch_id: "L1", action: "resume_schedules" },
  ],
  nimbio_add_hold_open_window: [{ latch_id: "L1", start: "s", end: "e" }],
  nimbio_remove_hold_open_window: [{ latch_id: "L1", event_id: "E1" }],
  nimbio_manage_recurring_hold_open: [
    { latch_id: "L1", action: "add", days_of_the_week: "MTW", start_time: "09:00", end_time: "17:00" },
    { latch_id: "L1", action: "add" },
    { latch_id: "L1", action: "update", temporal_date_id: "T1" },
    { latch_id: "L1", action: "update" },
    { latch_id: "L1", action: "remove", temporal_date_id: "T1" },
    { latch_id: "L1", action: "remove" },
  ],
  nimbio_list_members: [{}, { account_community_id: 7 }, { search: "ann" }, { page: 1 }],
  nimbio_key_schedule: [{}, { key_id: "K1" }],
  nimbio_add_members: [
    { members: [{ phone_number: "+15550000000", key_ids: ["K1"] }] },
    {
      members: [
        { phone_number: "+15550000000", key_ids: ["K1"] },
        { phone_number: "+15550000001", key_ids: ["K1"] },
      ],
    },
  ],
  nimbio_approve_member: [{ account_community_id: 7, key_ids: ["K1"] }, { account_community_id: 7, key_ids: ["K1"], dry_run: true }],
  nimbio_manage_member_keys: [
    { action: "grant", members: [{ account_community_id: 7, key_ids: ["K1"] }] },
    { action: "revoke", members: [{ account_community_id: 7, key_ids: ["K1"] }], remove_member: true },
    { action: "disable", members: [{ account_community_id: 7, key_ids: ["K1"] }] },
    { action: "enable", members: [{ account_community_id: 7, key_ids: ["K1"] }] },
    {
      action: "grant",
      members: [
        { account_community_id: 7, key_ids: ["K1"] },
        { account_community_id: 8, key_ids: ["K2"] },
      ],
    },
    {
      action: "revoke",
      members: [
        { account_community_id: 7, key_ids: ["K1"] },
        { account_community_id: 8, key_ids: ["K2"] },
      ],
    },
    {
      action: "disable",
      members: [
        { account_community_id: 7, key_ids: ["K1"] },
        { account_community_id: 8, key_ids: ["K2"] },
      ],
    },
  ],
  nimbio_update_key: [{ key_id: "K1", name: "new name" }],
  nimbio_set_key_schedule: [
    { key_id: "K1", windows: [{ days_of_the_week: "MTW", start_time: "09:00", end_time: "17:00" }] },
    { key_id: "K1", windows: null },
  ],
  nimbio_list_guest_links: [{}, { include_logs: true, include_exclusions: true, reveal: true }],
  nimbio_create_guest_link: [
    { link_type: "event", latch_ids: ["L1"] },
    { link_type: "limited_use", latch_ids: ["L1"], reveal: true },
  ],
  nimbio_revoke_guest_link: [{ guest_link_id: 1 }],
  nimbio_list_access_codes: [{}, { include_logs: true, include_eligible_latches: true }],
  nimbio_manage_access_code: [
    { action: "create", code: "1234", latch_ids: ["L1"] },
    { action: "create" },
    { action: "update", directory_access_code_id: 1, disabled: true },
    { action: "update" },
    { action: "delete", directory_access_code_id: 1 },
  ],
  nimbio_guest_view_entry: [{}, { include_logs: true }],
  nimbio_configure_guest_view_entry: [
    { action: "set_enabled", allowed: true },
    { action: "set_enabled" },
    { action: "set_latches", latch_ids: ["L1"] },
    { action: "set_latches" },
    { action: "add_schedule", days_of_the_week: "MTW", latch_ids: ["L1"] },
    { action: "add_schedule" },
    { action: "remove_schedule", schedule_id: 1 },
    { action: "remove_schedule" },
  ],
  nimbio_manage_short_code: [
    { action: "create" },
    { action: "assign", code: "GATE", latch_id: "L1" },
    { action: "assign" },
  ],
  nimbio_access_log: [{}, { account_community_id: 7, window: "week" }],
  nimbio_gate_status_log: [{}],
  nimbio_change_log: [{ type: "hold_open" }, { type: "hold_open", days: 90 }],
  nimbio_key_usage: [{ from: "2026-08-01", to: "2026-08-28" }],
  nimbio_update_settings: [{ settings: { some_key: 1 } }],
  nimbio_homes: [{}, { home_id: "H1" }],
  nimbio_manage_home: [
    { action: "add", home_address: "1 Main St" },
    { action: "add" },
    { action: "update", home_id: "H1", hidden: true },
    { action: "update" },
    { action: "set_move_out_date", account_community_id: 7, move_out_date: "2026-12-01" },
    { action: "set_move_out_date", account_community_id: 7, move_out_date: null },
    { action: "set_move_out_date" },
  ],
  nimbio_remove_home: [{ home_id: "H1" }],
  nimbio_sense_lines: [{}, { box_id: "B1" }, { box_id: "B1", sense_line_id: 1 }, { include_records: true }],
  nimbio_update_sense_line: [{ sense_line_id: 1, box_id: "B1", sense_line_online: true }],
  nimbio_nfc_tags: [{}, { tag_id: 1 }, { include_scan_log: true }],
  nimbio_update_nfc_tag: [{ tag_id: 1, latch_id: "L1" }, { tag_id: 1, latch_id: null }],
  nimbio_update_geofence: [{ latch_id: "L1", radius_meters: 50 }],
  nimbio_webhooks: [{}, { include_event_types: true }],
  nimbio_manage_webhook: [
    { action: "create", url: "https://x", events: ["e"] },
    { action: "create" },
    { action: "update", webhook_id: "W1", active: true },
    { action: "delete", webhook_id: "W1" },
    { action: "rotate_secret", webhook_id: "W1" },
    { action: "test", webhook_id: "W1" },
    { action: "delete" },
  ],
  nimbio_webhook_deliveries: [{ webhook_id: "W1" }],
  nimbio_replay_webhook: [
    { action: "replay_one", webhook_id: "W1", delivery_id: "D1" },
    { action: "replay_one", webhook_id: "W1" },
    { action: "retry_failed", webhook_id: "W1" },
  ],
  nimbio_messages: [{}],
  nimbio_send_message: [{ message: "hello" }],
  nimbio_my_notification_settings: [{}],
  nimbio_set_my_notifications: [
    { action: "set_enabled", enabled: true },
    { action: "set_enabled" },
    { action: "add_quiet_hours", days_of_the_week: "MTW", start_time: "22:00", end_time: "06:00" },
    { action: "add_quiet_hours" },
    { action: "remove_quiet_hours", quiet_hours_id: 1 },
    { action: "remove_quiet_hours" },
  ],
  nimbio_my_keys: [{}, { include_hidden: true }],
};

describe("every tool handler", () => {
  for (const tool of TOOLS) {
    const argSets = ARGS[tool.name] ?? [{}];
    it(`${tool.name} shapes a result for ${argSets.length} argument set(s)`, async () => {
      for (const args of argSets) {
        const { client } = stubClient();
        const ctx: ToolContext = {
          client,
          session,
          config,
          confirm: async () => ({ ok: true }),
        };
        const res = await tool.handler(ctx, args);
        expect(res.content.length, `${tool.name} ${JSON.stringify(args)}`).toBeGreaterThan(0);
        expect(typeof res.content[0]!.text).toBe("string");
        expect(res.content[0]!.text.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("every confirm builder", () => {
  for (const tool of TOOLS.filter((t) => t.confirm)) {
    it(`${tool.name} describes its consequence even when lookups fail`, async () => {
      const { client } = stubClient();
      // A confirm builder often names the thing it is about to change by
      // looking it up. That lookup is a courtesy, so it must never be what
      // stops a human being asked.
      const failing = {
        me: async () => chameleon(),
        community: new Proxy({}, { get: () => async () => { throw new Error("lookup down"); } }),
        account: new Proxy({}, { get: () => async () => { throw new Error("lookup down"); } }),
      } as never;
      for (const c of [client, failing]) {
        const ctx: ToolContext = { client: c, session, config, confirm: async () => ({ ok: true }) };
        const details = await tool.confirm!(ARGS[tool.name]?.[0] ?? {}, ctx);
        expect(details.action.length).toBeGreaterThan(5);
        expect(details.facts.length).toBeGreaterThan(0);
      }
    });
  }
});
