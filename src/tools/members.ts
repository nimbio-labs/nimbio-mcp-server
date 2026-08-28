/** Roster reads: who is in the community and what access they hold. */
import { z } from "zod";
import { ok } from "../format.js";
import type { ToolDef } from "./types.js";

export const listMembers: ToolDef = {
  name: "nimbio_list_members",
  title: "List members",
  description:
    "The community roster. With no arguments you get every member grouped as accepted, " +
    "pending (awaiting a manager's approval) and removed. Pass search or page to use the " +
    "paged, searchable view instead, or account_community_id for one member in full — " +
    "their keys, phone numbers, home and move-out date. " +
    "account_community_id is the id every member-specific tool wants.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "members",
  inputSchema: {
    account_community_id: z
      .number()
      .int()
      .optional()
      .describe("Fetch exactly this member, in full detail."),
    search: z.string().optional().describe("Name or phone fragment; switches to the paged view."),
    bucket: z
      .enum(["accepted", "unaccepted", "removed"])
      .optional()
      .describe("Which group to page through. Defaults to accepted."),
    page: z.number().int().min(0).optional(),
    size: z.number().int().min(1).max(200).optional(),
  },
  endpoints: [
    "GET /v1/community/members",
    "GET /v1/community/members/page",
    "GET /v1/community/members/{}",
  ],
  async handler(ctx, args) {
    const c = ctx.client.community;

    if (typeof args.account_community_id === "number") {
      const m = await c.member(args.account_community_id);
      const structured = {
        member: {
          account_community_id: m.accountCommunityId,
          name: m.fullName,
          accepted: m.accepted,
          phone_numbers: m.phoneNumbers,
          home_address: m.homeAddress,
          move_out_date: m.moveOutDate,
          subkey_count: m.subkeyCount,
          keys: m.keys.map((k) => ({ key_id: k.keyId, name: k.keyName, disabled: k.disabled })),
        },
      };
      const keyList = m.keys.map((k) => `${k.keyName ?? k.keyId}${k.disabled ? " (disabled)" : ""}`);
      return ok(
        ctx.session,
        [
          `${m.fullName} — member ${m.accountCommunityId}, ${m.accepted ? "accepted" : "PENDING approval"}.`,
          m.homeAddress ? `Home: ${m.homeAddress}.` : null,
          m.moveOutDate ? `Move-out date: ${m.moveOutDate}.` : null,
          `Keys (${m.keys.length}): ${keyList.join(", ") || "none"}.`,
        ]
          .filter(Boolean)
          .join("\n"),
        structured,
      );
    }

    const paged = args.search !== undefined || args.page !== undefined || args.bucket !== undefined;
    if (paged) {
      const page = await c.membersPage({
        bucket: args.bucket as never,
        page: args.page as number | undefined,
        size: args.size as number | undefined,
        search: args.search as string | undefined,
      });
      const structured = {
        bucket: page.bucket,
        page: page.page,
        total: page.total,
        has_more: page.hasMore,
        members: page.members.map((m) => ({
          account_community_id: m.accountCommunityId,
          name: m.fullName,
          accepted: m.accepted,
          home_address: m.homeAddress,
          key_count: m.keys.length,
        })),
      };
      return ok(
        ctx.session,
        `${page.members.length} of ${page.total ?? "?"} in bucket "${page.bucket}" ` +
          `(page ${page.page}${page.hasMore ? ", more available" : ""}):\n` +
          page.members.map((m) => `- ${m.fullName} [${m.accountCommunityId}]`).join("\n"),
        structured,
      );
    }

    const all = await c.members();
    const structured = {
      accepted: all.accepted.map((m) => ({ account_community_id: m.accountCommunityId, name: m.fullName })),
      pending: all.unaccepted.map((m) => ({ account_community_id: m.accountCommunityId, name: m.fullName })),
      removed: all.removed.map((m) => ({ account_community_id: m.accountCommunityId, name: m.fullName })),
    };
    return ok(
      ctx.session,
      `${all.accepted.length} accepted, ${all.unaccepted.length} pending approval, ` +
        `${all.removed.length} removed.` +
        (all.unaccepted.length
          ? `\nPending: ${all.unaccepted.map((m) => `${m.fullName} [${m.accountCommunityId}]`).join(", ")}`
          : ""),
      structured,
    );
  },
};

export const keySchedule: ToolDef = {
  name: "nimbio_key_schedule",
  title: "Access schedules",
  description:
    "When each key is allowed to open a gate. With no arguments: every key's schedule, plus " +
    "the keys blocked outright. With key_id: that one key in detail. A key with no schedule " +
    "is unrestricted — it opens at any hour. Times are in the community's local timezone.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "key_schedules",
  inputSchema: { key_id: z.string().optional().describe("Read one key's schedule in detail.") },
  endpoints: ["GET /v1/community/key-schedules", "GET /v1/community/keys/{}/schedule"],
  async handler(ctx, args) {
    const c = ctx.client.community;
    if (typeof args.key_id === "string") {
      const s = await c.keySchedule(args.key_id);
      const structured = {
        key_id: s.keyId,
        key_name: s.keyName,
        restricted: s.restricted,
        permanently_blocked: s.permanentlyBlocked,
        windows: s.windows,
        latch_count: s.latchCount,
      };
      return ok(
        ctx.session,
        `${s.keyName ?? s.keyId}: ` +
          (s.permanentlyBlocked
            ? "permanently blocked."
            : s.restricted
              ? `${s.windows.length} scheduled window(s).`
              : "unrestricted — opens at any hour."),
        structured,
      );
    }
    const all = await c.keySchedules();
    const structured = {
      keys: all.keys.map((k) => ({
        key_id: k.keyId,
        key_name: k.keyName,
        restricted: k.restricted,
        window_count: k.windows.length,
      })),
      blocked: all.blocked.map((k) => ({ key_id: k.keyId, key_name: k.keyName })),
    };
    return ok(
      ctx.session,
      `${all.keys.length} key(s) with schedules, ${all.blocked.length} blocked outright.`,
      structured,
    );
  },
};

export const communityKeys: ToolDef = {
  name: "nimbio_list_keys",
  title: "List community keys",
  description:
    "Every key issued in this community, with its restrictions: disabled, hidden, pending, " +
    "expiry and temporal limits, and which latches it reaches. Keys are per-account — sharing " +
    "a key mints a new child key on the recipient's account rather than pointing two people " +
    "at one row.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "members",
  endpoints: ["GET /v1/community/keys"],
  async handler(ctx) {
    const keys = await ctx.client.community.keys();
    const structured = {
      keys: keys.map((k) => ({
        key_id: k.id,
        name: k.name,
        disabled: k.disabled,
        hidden: k.hidden,
        pending: k.pending,
        expiry: k.expiry,
        temporal: k.temporal,
        latch_count: Array.isArray(k.latches) ? k.latches.length : 0,
      })),
    };
    const disabled = keys.filter((k) => k.disabled).length;
    return ok(
      ctx.session,
      `${keys.length} key(s) in this community${disabled ? `, ${disabled} disabled` : ""}.`,
      structured,
    );
  },
};
