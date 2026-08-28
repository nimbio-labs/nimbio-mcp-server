/** Gate-side reads: the roster, per-key access, and what is being held open. */
import { ok } from "../format.js";
import type { ToolDef } from "./types.js";

export const listGates: ToolDef = {
  name: "nimbio_list_gates",
  title: "List gates",
  description:
    "The community's gates with the ids every other gate tool needs, plus the map: where each " +
    "box sits, its geofence mode and radius. Use this to resolve a gate people refer to by " +
    "name (\"the north gate\") into the latch_id the API wants.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "map",
  endpoints: ["GET /v1/community/map", "GET /v1/community/key-statuses"],
  async handler(ctx) {
    const map = await ctx.client.community.map();
    const structured = {
      community_location: map.communityLocation,
      min_radius_meters: map.minRadiusMeters,
      geofence_modes: map.geofenceModes,
      boxes: map.boxes.map((b) => ({ ...b.raw })),
    };
    const summary =
      `${map.boxes.length} box(es) on the map. ` +
      `Geofence modes available: ${map.geofenceModes.join(", ") || "(none)"}. ` +
      (map.minRadiusMeters !== null ? `Minimum radius ${map.minRadiusMeters}m.` : "");
    return ok(ctx.session, summary, structured);
  },
};

export const keyStatuses: ToolDef = {
  name: "nimbio_key_statuses",
  title: "Key and latch statuses",
  description:
    "Every community key with the latches it reaches and their current status, plus the " +
    "hold-open state layered on top. This is the 'who can open what, right now' view — " +
    "broader than nimbio_gate_status, which is only the physical sensed state.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "key_statuses",
  endpoints: ["GET /v1/community/key-statuses"],
  async handler(ctx) {
    const s = await ctx.client.community.keyStatuses();
    const structured = { keys: s.keys, hold_opens: s.holdOpens };
    return ok(ctx.session, `${s.keys.length} key(s) with latch status attached.`, structured);
  },
};

export const holdOpens: ToolDef = {
  name: "nimbio_hold_opens",
  title: "Hold opens",
  description:
    "Which gates are being held open and why: manual indefinite holds, timed windows, and " +
    "recurring weekly schedules, plus any latch whose hold opens are currently suspended. " +
    "Times come back in the latch's own local timezone, never UTC.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "hold_opens",
  endpoints: ["GET /v1/community/hold-opens"],
  async handler(ctx) {
    const h = await ctx.client.community.holdOpens();
    const rows = Object.values(h.latches);
    const structured = {
      latches: rows.map((l) => ({
        latch_id: l.latchId,
        name: l.latchName,
        held_open: l.heldOpen,
        manual: l.manual,
        disabled_until: l.disabledUntil,
        timezone: l.timezone,
        events: l.events,
        recurring: l.recurring,
      })),
    };
    const summary = rows.length
      ? rows
          .map((l) => {
            const bits = [
              l.heldOpen ? "HELD OPEN" : "closed",
              l.manual ? "manual" : null,
              l.events.length ? `${l.events.length} timed window(s)` : null,
              l.recurring.length ? `${l.recurring.length} recurring` : null,
              l.disabledUntil ? `suspended until ${l.disabledUntil}` : null,
            ].filter(Boolean);
            return `- ${l.latchName ?? l.latchId}: ${bits.join(", ")}`;
          })
          .join("\n")
      : "No hold-open configuration on any latch.";
    return ok(ctx.session, summary, structured);
  },
};
