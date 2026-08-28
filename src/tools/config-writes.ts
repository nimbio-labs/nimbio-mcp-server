/** Configuration, homes and hardware writes. */
import { z } from "zod";
import { wrote, fail } from "../format.js";
import type { ToolDef } from "./types.js";

export const updateSettings: ToolDef = {
  name: "nimbio_update_settings",
  title: "Update community settings",
  description:
    "Change the community's settable options and the words it uses for members and homes. " +
    "The patch is ALL-OR-NOTHING: the whole thing is validated before anything is written, so " +
    "one bad value applies none of it — you never have to reason about a half-applied change. " +
    "The response reports which keys actually changed. Feature flags in the read_only block " +
    "are Nimbio-side provisioning decisions and are rejected with a 422 naming the offender.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  capability: "settings",
  inputSchema: {
    settings: z
      .record(z.string(), z.unknown())
      .describe("Partial patch of settable keys. Read nimbio_settings first to see them."),
  },
  endpoints: ["PATCH /v1/community/settings"],
  async handler(ctx, args) {
    const res = await ctx.client.community.updateSettings(args.settings as never);
    return wrote(
      ctx.session,
      res.changed.length
        ? `Changed: ${res.changed.join(", ")}.`
        : "Nothing changed — the patch matched the current values.",
      { changed: res.changed, settings: res.settings, simulated: res.simulated },
    );
  },
};

export const manageHome: ToolDef = {
  name: "nimbio_manage_home",
  title: "Add or update a home",
  description:
    "Add a unit to the community, change its address or flags, or set a resident's move-out " +
    "date. To delete a home use nimbio_remove_home — it is separate because it detaches every " +
    "resident.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  capability: "homes",
  inputSchema: {
    action: z.enum(["add", "update", "set_move_out_date"]),
    home_id: z.string().optional().describe("Required for update."),
    home_address: z.string().optional().describe("Required for add; optional for update."),
    owner_occupied: z.boolean().optional(),
    hidden: z.boolean().optional(),
    account_community_id: z.number().int().optional().describe("Required for set_move_out_date."),
    move_out_date: z.string().nullable().optional().describe("YYYY-MM-DD, or null to clear."),
  },
  endpoints: [
    "POST /v1/community/homes",
    "PATCH /v1/community/homes/{}",
    "PUT /v1/community/members/{}/move-out-date",
  ],
  async handler(ctx, args) {
    const c = ctx.client.community;
    if (args.action === "add") {
      if (typeof args.home_address !== "string") return fail("add needs `home_address`.");
      const res = await c.addHome(args.home_address);
      return wrote(ctx.session, `Home added: ${args.home_address}.`, {
        ...res.raw,
        simulated: res.simulated,
      });
    }
    if (args.action === "set_move_out_date") {
      if (typeof args.account_community_id !== "number") {
        return fail("set_move_out_date needs `account_community_id`.");
      }
      const res = await c.setMoveOutDate(
        args.account_community_id,
        (args.move_out_date as string | null) ?? null,
      );
      return wrote(
        ctx.session,
        res.moveOutDate
          ? `Move-out date for member ${res.accountCommunityId} set to ${res.moveOutDate}.`
          : `Move-out date cleared for member ${res.accountCommunityId}.`,
        { ...res.raw, simulated: res.simulated },
      );
    }
    if (typeof args.home_id !== "string") return fail("update needs `home_id`.");
    const res = await c.updateHome(args.home_id, {
      homeAddress: args.home_address as string | undefined,
      ownerOccupied: args.owner_occupied as boolean | undefined,
      hidden: args.hidden as boolean | undefined,
    });
    return wrote(ctx.session, `Home ${args.home_id} updated.`, {
      ...res.raw,
      simulated: res.simulated,
    });
  },
};

export const removeHome: ToolDef = {
  name: "nimbio_remove_home",
  title: "Remove a home",
  description:
    "Delete a unit. Every resident attached to it is DETACHED: they stay members and keep " +
    "their keys, but they are no longer attached to any unit, and nothing restores that " +
    "automatically — you would have to re-add the home and re-attach each person by hand. " +
    "The response reports how many were detached.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: "homes",
  inputSchema: { home_id: z.string() },
  endpoints: ["DELETE /v1/community/homes/{}"],
  async confirm(args, ctx) {
    let facts = ["Residents will be detached from this unit and nothing restores that automatically."];
    try {
      const home = await ctx.client.community.home(args.home_id as string);
      facts = [
        `Home: ${home.address ?? home.name ?? home.homeId}`,
        `${home.memberCount} resident(s) will be DETACHED. They keep their keys and stay ` +
          "members, but are no longer attached to any unit.",
        "Nothing restores this automatically — re-adding means re-attaching each person by hand.",
      ];
    } catch {
      // Fall back to the generic warning.
    }
    return { action: `Remove home ${args.home_id}`, facts };
  },
  async handler(ctx, args) {
    const res = await ctx.client.community.removeHome(args.home_id as string);
    return wrote(
      ctx.session,
      `Home ${res.homeId} removed. ${res.detachedMemberCount} resident(s) detached.`,
      {
        home_id: res.homeId,
        deleted: res.deleted,
        detached_member_count: res.detachedMemberCount,
        result: res.result,
        simulated: res.simulated,
      },
    );
  },
};

export const updateSenseLine: ToolDef = {
  name: "nimbio_update_sense_line",
  title: "Reconfigure a sense line",
  description:
    "Turn a sense line's reporting on or off. A sense line is what tells Nimbio whether a gate " +
    "is physically open — switching it off makes gate status blind for that gate, so the " +
    "system will report what it was last told rather than what is true.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  capability: "sense_lines",
  inputSchema: {
    sense_line_id: z.union([z.number(), z.string()]),
    box_id: z.string(),
    sense_line_online: z.boolean().optional(),
    latch_data_online: z.boolean().optional(),
  },
  endpoints: ["PATCH /v1/community/sense-lines/{}"],
  async handler(ctx, args) {
    const res = await ctx.client.community.updateSenseLine(
      args.sense_line_id as string | number,
      args.box_id as string,
      {
        senseLineOnline: args.sense_line_online as boolean | undefined,
        latchDataOnline: args.latch_data_online as boolean | undefined,
      },
    );
    return wrote(ctx.session, `Sense line ${args.sense_line_id} on box ${args.box_id} updated.`, {
      ...res.raw,
    });
  },
};

export const updateNfcTag: ToolDef = {
  name: "nimbio_update_nfc_tag",
  title: "Assign, unassign or disable an NFC tag",
  description:
    "Point a physical NFC tag at a gate, unassign it (latch_id: null), or disable it entirely. " +
    "A disabled tag stops opening anything immediately — the usual response to a lost tag.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  capability: "nfc_tags",
  inputSchema: {
    tag_id: z.union([z.string(), z.number()]),
    latch_id: z.string().nullable().optional().describe("Gate to assign to, or null to unassign."),
    disabled: z.boolean().optional(),
    confirm: z.boolean().optional().describe("Set when the API asks for confirmation (409 requires_confirmation)."),
  },
  endpoints: ["PATCH /v1/community/nfc-tags/{}"],
  async handler(ctx, args) {
    const res = await ctx.client.community.updateNfcTag(args.tag_id as string | number, {
      latchId: args.latch_id as string | null | undefined,
      disabled: args.disabled as boolean | undefined,
      confirm: args.confirm as boolean | undefined,
    });
    return wrote(ctx.session, `Tag ${args.tag_id} updated.`, {
      tag: res.tag?.raw ?? null,
      would_change: res.wouldChange,
      result: res.result,
      simulated: res.simulated,
    });
  },
};

export const updateGeofence: ToolDef = {
  name: "nimbio_update_geofence",
  title: "Update a gate's geofence",
  description:
    "Move or resize the geofence that decides how close someone must be to open a gate, or " +
    "switch its mode. Widening it lets people open the gate from further away; disabling it " +
    "removes the distance check altogether.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  capability: "map",
  inputSchema: {
    latch_id: z.string(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    radius_meters: z.number().optional().describe("Subject to the community's minimum."),
    enabled: z.boolean().optional(),
    mode: z.string().optional().describe("One of the modes reported by nimbio_list_gates."),
  },
  endpoints: ["PATCH /v1/community/latches/{}/geofence"],
  async handler(ctx, args) {
    const res = await ctx.client.community.updateGeofence(args.latch_id as string, {
      latitude: args.latitude as number | undefined,
      longitude: args.longitude as number | undefined,
      radiusMeters: args.radius_meters as number | undefined,
      enabled: args.enabled as boolean | undefined,
      mode: args.mode as never,
    });
    return wrote(ctx.session, `Geofence updated on ${res.latchId}.`, {
      latch_id: res.latchId,
      geofence: res.geofence,
      would_set: res.wouldSet,
      min_radius_meters: res.minRadiusMeters,
      result: res.result,
      simulated: res.simulated,
    });
  },
};
