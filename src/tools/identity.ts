/** Orientation tools: who am I, what am I looking at, what is open right now. */
import { ok } from "../format.js";
import type { ToolDef } from "./types.js";

export const whoami: ToolDef = {
  name: "nimbio_whoami",
  title: "Who am I",
  description:
    "Describe the API key this server is running with: its scope (account or community), " +
    "whether it is a test or live key, which community it acts on, what it is allowed to do, " +
    "and how much of its rate limit and monthly quota is left. Call this first when you are " +
    "unsure what you can do — every other tool's availability follows from it.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  scope: "any",
  endpoints: ["GET /v1/me"],
  async handler(ctx) {
    const s = ctx.session;
    const structured = {
      scope: s.scope,
      mode: s.testMode ? "test" : "live",
      environment: s.environment,
      api_host: s.baseUrl,
      community_id: s.communityId,
      key_name: s.keyName,
      capabilities: s.capabilities,
      writes_permitted: s.writesPermitted,
      writes_withheld_reason: s.writesWithheldReason,
      server_mode: ctx.config.mode,
      minute_limit: s.minuteLimit,
      month_limit: s.monthLimit,
      month_used: s.monthCount,
    };
    const lines = [
      `Key "${s.keyName ?? "(unnamed)"}" — ${s.scope} scope, ${s.testMode ? "test" : "live"} mode.`,
      `Talking to ${s.baseUrl} (${s.environment}).`,
      s.communityId ? `Acting on community ${s.communityId}.` : "No community attached.",
      `${s.capabilities.length} capabilities: ${s.capabilities.join(", ") || "(none)"}.`,
      s.writesPermitted
        ? `Write tools are registered (server mode: ${ctx.config.mode}).`
        : `Write tools are NOT registered. ${s.writesWithheldReason}`,
      s.monthLimit !== null
        ? `Monthly quota: ${s.monthCount ?? 0} of ${s.monthLimit} used.`
        : "Monthly quota: not reported.",
    ];
    return ok(s, lines.join("\n"), structured);
  },
};

export const gateStatus: ToolDef = {
  name: "nimbio_gate_status",
  title: "Gate status",
  description:
    "The latest sensed open/closed state of every gate in the community, with the gate ids " +
    "you need for any other gate-specific tool. Offline gates are reported as offline rather " +
    "than guessed at.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "gate_status",
  endpoints: ["GET /v1/community/gate-status"],
  async handler(ctx) {
    const status = await ctx.client.community.gateStatus();
    const structured = {
      latches: status.latches.map((l) => ({
        latch_id: l.latchId,
        name: l.latchName,
        status: l.status,
        offline: l.offline,
        message: l.message,
      })),
    };
    const summary = status.latches.length
      ? status.latches
          .map(
            (l) =>
              `- ${l.latchName ?? l.latchId}: ${l.offline ? "OFFLINE" : (l.status ?? "unknown")}` +
              (l.message ? ` (${l.message})` : ""),
          )
          .join("\n")
      : "No gates reported for this community.";
    return ok(ctx.session, `${status.latches.length} gate(s):\n${summary}`, structured);
  },
};

export const communityOverview: ToolDef = {
  name: "nimbio_community_overview",
  title: "Community overview",
  description:
    "One call that answers 'what am I looking at': the community's name, timezone and unit " +
    "count, which features are switched on, and the current state of every gate. The feature " +
    "flags matter — several tool families are gated on them, and reading them here is how you " +
    "learn a feature is off without calling it and interpreting a permission error.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  endpoints: ["GET /v1/community", "GET /v1/community/settings", "GET /v1/community/gate-status"],
  async handler(ctx) {
    const { client, session } = ctx;
    const has = (c: string) => ctx.config.allTools || session.capabilities.includes(c);

    const info = await client.community.info();
    const [settings, gates] = await Promise.all([
      has("settings") ? client.community.settings().catch(() => null) : Promise.resolve(null),
      has("gate_status") ? client.community.gateStatus().catch(() => null) : Promise.resolve(null),
    ]);

    const structured = {
      community: {
        community_id: info.communityId,
        name: info.name,
        active: info.active,
        timezone: info.timezone,
        number_of_units: info.numberOfUnits,
      },
      features: {
        hold_opens: info.features.holdOpens,
        access_log_history: info.features.accessLogHistory,
        directory_viewing: info.features.directoryViewing,
        directory_access_codes: info.features.directoryAccessCodes,
        guest_view_entry: info.features.guestViewEntry,
        subkeys: info.features.subkeys,
        member_open_notifications: info.features.memberOpenNotifications,
        event_keys: info.features.eventKeys,
      },
      terminology: settings ? settings.terminology : null,
      gates:
        gates?.latches.map((l) => ({
          latch_id: l.latchId,
          name: l.latchName,
          status: l.status,
          offline: l.offline,
        })) ?? null,
    };

    const on = Object.entries(structured.features)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const off = Object.entries(structured.features)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    const lines = [
      `${info.name ?? "(unnamed)"} — community ${info.communityId}, ${info.active ? "active" : "INACTIVE"}.`,
      `Timezone ${info.timezone ?? "unknown"}, ${info.numberOfUnits ?? "unknown"} units.`,
      `Features on: ${on.join(", ") || "(none)"}.`,
      `Features off: ${off.join(", ") || "(none)"}.`,
      gates
        ? `${gates.latches.length} gate(s): ` +
          gates.latches
            .map((l) => `${l.latchName ?? l.latchId} ${l.offline ? "(offline)" : `(${l.status ?? "?"})`}`)
            .join(", ")
        : "Gate status not available with this key.",
    ];
    return ok(session, lines.join("\n"), structured);
  },
};
