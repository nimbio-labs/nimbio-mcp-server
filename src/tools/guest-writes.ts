/** Guest access writes — issuing and revoking ways in for people without accounts. */
import { z } from "zod";
import { wrote, fail } from "../format.js";
import { redactLink, REDACTION_NOTE } from "../redact.js";
import type { ToolDef } from "./types.js";

export const createGuestLink: ToolDef = {
  name: "nimbio_create_guest_link",
  title: "Create a guest link",
  description:
    "Mint a link that opens a gate for someone with no account and no app. Two types: `event` " +
    "is bounded by a time window; `limited_use` is bounded by a number of uses and an expiry. " +
    "The returned token and URL are redacted unless you pass reveal — anyone holding the URL " +
    "can open the gate, so treat it as a credential and send it to the guest, not into a log.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  capability: "guest_links",
  inputSchema: {
    link_type: z.enum(["event", "limited_use"]),
    latch_ids: z.array(z.string()).min(1).describe("Gates the link opens."),
    key_id: z.string().optional(),
    title: z.string().optional().describe("Shown to the guest."),
    subtitle: z.string().optional(),
    extra_info: z.string().optional(),
    max_uses: z.number().int().min(1).optional().describe("limited_use only."),
    expires_at: z.string().optional().describe("limited_use only: ISO-8601, at most 30 days out."),
    window_start: z.string().optional().describe("event only: ISO-8601 window start."),
    window_end: z.string().optional().describe("event only: ISO-8601 window end."),
    notify_on_use: z.boolean().optional(),
    reveal: z
      .boolean()
      .optional()
      .describe("Return the token and URL in full. This writes a working gate credential into the conversation."),
  },
  endpoints: ["POST /v1/community/guest-links"],
  async handler(ctx, args) {
    const res = await ctx.client.community.createGuestLink(
      args.link_type as never,
      args.latch_ids as string[],
      {
        keyId: args.key_id as string | undefined,
        title: args.title as string | undefined,
        subtitle: args.subtitle as string | undefined,
        extraInfo: args.extra_info as string | undefined,
        maxUses: args.max_uses as number | undefined,
        expiresAt: args.expires_at as string | undefined,
        windowStart: args.window_start as string | undefined,
        windowEnd: args.window_end as string | undefined,
        notifyOnUse: args.notify_on_use as boolean | undefined,
      },
    );
    const reveal = Boolean(args.reveal);
    const link = res.guestLink;
    const structured = {
      guest_link_id: res.guestLinkId,
      result: res.result,
      simulated: res.simulated,
      link: link
        ? redactLink(
            {
              guest_link_id: link.guestLinkId,
              type: link.linkType,
              state: link.state,
              title: link.title,
              latches: link.latches.map((l) => l.latchName),
              max_uses: link.maxUses,
              token: link.token,
              url: link.url,
            },
            reveal,
          )
        : null,
    };
    return wrote(
      ctx.session,
      [
        `Guest link ${res.guestLinkId} created (${args.link_type}), covering ` +
          `${(args.latch_ids as string[]).length} gate(s).`,
        reveal ? "Token and URL are included below — treat them as a credential." : REDACTION_NOTE,
      ].join("\n"),
      structured,
    );
  },
};

export const revokeGuestLink: ToolDef = {
  name: "nimbio_revoke_guest_link",
  title: "Revoke a guest link",
  description:
    "Kill a guest link immediately. Anyone holding the URL loses access at once — including " +
    "someone who may be standing at the gate right now.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  capability: "guest_links",
  inputSchema: { guest_link_id: z.union([z.number(), z.string()]) },
  endpoints: ["DELETE /v1/community/guest-links/{}"],
  async confirm(args, ctx) {
    let detail = `Guest link ${args.guest_link_id}`;
    try {
      const links = await ctx.client.community.guestLinks({ includeInactive: true });
      const match = links.find((l) => String(l.guestLinkId) === String(args.guest_link_id));
      if (match) {
        detail =
          `Guest link ${match.guestLinkId}: "${match.title ?? "(untitled)"}" ` +
          `(${match.linkType}, currently ${match.state})`;
      }
    } catch {
      // Naming is a courtesy.
    }
    return {
      action: `Revoke ${detail}`,
      facts: [
        "Anyone holding this link loses access immediately, including someone at the gate now.",
        "Revoking cannot be undone — you would have to issue a new link.",
      ],
    };
  },
  async handler(ctx, args) {
    const res = await ctx.client.community.revokeGuestLink(args.guest_link_id as string | number);
    return wrote(ctx.session, `Guest link ${args.guest_link_id} revoked.`, {
      guest_link_id: res.guestLinkId,
      result: res.result,
      simulated: res.simulated,
    });
  },
};

export const manageAccessCode: ToolDef = {
  name: "nimbio_manage_access_code",
  title: "Create, change or delete an access code",
  description:
    "Numeric door codes. create needs the code itself and the gates it opens; update can " +
    "disable it, change its gates or its expiry; delete removes it. Expiry is either " +
    "expires_in_hours or expires_in_days, never both. A recurring weekly window is evaluated " +
    "in the GATE's local timezone.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: "access_codes",
  inputSchema: {
    action: z.enum(["create", "update", "delete"]),
    directory_access_code_id: z.union([z.number(), z.string()]).optional().describe("Required for update and delete."),
    code: z.string().optional().describe("Required for create."),
    latch_ids: z.array(z.string()).optional(),
    disabled: z.boolean().optional(),
    expires_in_hours: z.number().int().optional(),
    expires_in_days: z.number().int().optional(),
  },
  endpoints: [
    "POST /v1/community/access-codes",
    "PATCH /v1/community/access-codes/{}",
    "DELETE /v1/community/access-codes/{}",
  ],
  async handler(ctx, args) {
    const c = ctx.client.community;
    if (args.action === "create") {
      if (typeof args.code !== "string" || !Array.isArray(args.latch_ids)) {
        return fail("create needs `code` and `latch_ids`.");
      }
      const res = await c.createAccessCode(args.code, args.latch_ids as string[], {
        expiresInHours: args.expires_in_hours as number | undefined,
        expiresInDays: args.expires_in_days as number | undefined,
      });
      return wrote(ctx.session, `Access code ${res.directoryAccessCodeId} created.`, {
        directory_access_code_id: res.directoryAccessCodeId,
        result: res.result,
        simulated: res.simulated,
      });
    }
    if (args.directory_access_code_id === undefined) {
      return fail(`${args.action} needs directory_access_code_id — from nimbio_list_access_codes.`);
    }
    if (args.action === "delete") {
      const res = await c.deleteAccessCode(args.directory_access_code_id as string | number);
      return wrote(ctx.session, `Access code ${args.directory_access_code_id} deleted.`, {
        result: res.result,
        simulated: res.simulated,
      });
    }
    const res = await c.updateAccessCode(args.directory_access_code_id as string | number, {
      disabled: args.disabled as boolean | undefined,
      latchIds: args.latch_ids as string[] | undefined,
      expiresInHours: args.expires_in_hours as number | undefined,
      expiresInDays: args.expires_in_days as number | undefined,
    });
    return wrote(ctx.session, `Access code ${args.directory_access_code_id} updated.`, {
      result: res.result,
      simulated: res.simulated,
    });
  },
};

export const configureGuestViewEntry: ToolDef = {
  name: "nimbio_configure_guest_view_entry",
  title: "Configure GuestView Entry",
  description:
    "Turn on or off the ability for visitors browsing the directory to let themselves in, set " +
    "which gates it covers, and add or remove the weekly windows it works during. Setting the " +
    "gates REPLACES the list. Days are MTWHFSU with H for Thursday; windows may not wrap past " +
    "midnight.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  capability: "guest_view_entry",
  inputSchema: {
    action: z.enum(["set_enabled", "set_latches", "add_schedule", "remove_schedule"]),
    allowed: z.boolean().optional().describe("set_enabled only."),
    latch_ids: z.array(z.string()).optional().describe("set_latches (replaces) or add_schedule."),
    days_of_the_week: z.string().optional().describe("add_schedule: letters from MTWHFSU, H=Thursday."),
    start_time: z.string().optional().describe("HH:MM, gate-local."),
    end_time: z.string().optional().describe("HH:MM, gate-local. No wrapping past midnight."),
    schedule_id: z.union([z.number(), z.string()]).optional().describe("remove_schedule only."),
  },
  endpoints: [
    "PUT /v1/community/guest-view-entry",
    "PUT /v1/community/guest-view-entry/eligible-latches",
    "POST /v1/community/guest-view-entry/schedule",
    "DELETE /v1/community/guest-view-entry/schedule/{}",
  ],
  async handler(ctx, args) {
    const c = ctx.client.community;
    switch (args.action) {
      case "set_enabled": {
        if (typeof args.allowed !== "boolean") return fail("set_enabled needs `allowed`.");
        const res = await c.setGuestViewEntryEnabled(args.allowed);
        return wrote(ctx.session, `GuestView Entry is now ${res.allowed ? "ON" : "OFF"}.`, {
          allowed: res.allowed,
          result: res.result,
          simulated: res.simulated,
        });
      }
      case "set_latches": {
        if (!Array.isArray(args.latch_ids)) return fail("set_latches needs `latch_ids`.");
        const res = await c.setGuestViewEntryLatches(args.latch_ids as string[]);
        return wrote(
          ctx.session,
          `GuestView Entry now covers ${res.eligibleLatches.length} gate(s) — the list was replaced.`,
          { eligible_latches: res.eligibleLatches, result: res.result, simulated: res.simulated },
        );
      }
      case "add_schedule": {
        if (typeof args.days_of_the_week !== "string" || !Array.isArray(args.latch_ids)) {
          return fail("add_schedule needs `days_of_the_week` and `latch_ids`.");
        }
        const res = await c.addGuestViewEntrySchedule(args.days_of_the_week, args.latch_ids as string[], {
          startTime: args.start_time as string | undefined,
          endTime: args.end_time as string | undefined,
        });
        return wrote(ctx.session, `Window added (${args.days_of_the_week}).`, {
          created_schedule_ids: res.createdScheduleIds,
          result: res.result,
          simulated: res.simulated,
        });
      }
      default: {
        if (args.schedule_id === undefined) return fail("remove_schedule needs `schedule_id`.");
        const res = await c.removeGuestViewEntrySchedule(args.schedule_id as string | number);
        return wrote(ctx.session, `Window ${args.schedule_id} removed.`, {
          removed_schedule_id: res.removedScheduleId,
          result: res.result,
          simulated: res.simulated,
        });
      }
    }
  },
};

export const manageShortCode: ToolDef = {
  name: "nimbio_manage_short_code",
  title: "Create or assign a short code",
  description:
    "Short codes map a memorable string to one gate, for signage or a printed card. create " +
    "mints one (optionally with a code you choose); assign points an existing code at a gate.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  capability: "short_codes",
  inputSchema: {
    action: z.enum(["create", "assign"]),
    code: z.string().optional().describe("create: optional preferred code. assign: required."),
    latch_id: z.string().optional().describe("The gate this code opens."),
  },
  endpoints: ["POST /v1/community/short-codes", "PUT /v1/community/short-codes/{}"],
  async handler(ctx, args) {
    const c = ctx.client.community;
    if (args.action === "assign") {
      if (typeof args.code !== "string" || typeof args.latch_id !== "string") {
        return fail("assign needs `code` and `latch_id`.");
      }
      const res = await c.assignShortCode(args.code, args.latch_id);
      return wrote(ctx.session, `Short code ${res.code} now opens ${args.latch_id}.`, {
        code: res.code,
        result: res.result,
        simulated: res.simulated,
      });
    }
    const res = await c.createShortCode({
      code: args.code as string | undefined,
      latchId: args.latch_id as string | undefined,
    });
    return wrote(ctx.session, `Short code ${res.code} created.`, {
      code: res.code,
      short_code: res.shortCode,
      result: res.result,
      simulated: res.simulated,
    });
  },
};
