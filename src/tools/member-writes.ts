/** Member and key lifecycle writes. */
import { z } from "zod";
import { wrote } from "../format.js";
import type { ToolDef } from "./types.js";

export const addMembers: ToolDef = {
  name: "nimbio_add_members",
  title: "Add members",
  description:
    "Add one or more people to the community by phone number, granting each the keys you name. " +
    "Adding a member sends them an invitation — this reaches a real person's phone. Keys are " +
    "per-account: granting a key mints a new child key on their account rather than sharing " +
    "yours.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  capability: "members",
  inputSchema: {
    members: z
      .array(
        z.object({
          phone_number: z.string().describe("E.164 or local format, as the community uses."),
          key_ids: z.array(z.string()).describe("Keys to grant, from nimbio_list_keys."),
        }),
      )
      .min(1)
      .describe("One entry per person. A single entry uses the single-add endpoint."),
  },
  endpoints: ["POST /v1/community/members", "POST /v1/community/members/bulk-add"],
  async handler(ctx, args) {
    const rows = args.members as { phone_number: string; key_ids: string[] }[];
    const c = ctx.client.community;
    if (rows.length === 1) {
      const only = rows[0]!;
      const res = await c.addMember(only.phone_number, only.key_ids);
      return wrote(ctx.session, `Added ${only.phone_number} with ${only.key_ids.length} key(s).`, {
        result: res.result,
        request_id: res.requestId,
        simulated: res.simulated,
      });
    }
    const res = await c.bulkAddMembers(
      rows.map((r) => ({ phoneNumber: r.phone_number, keyIds: r.key_ids })),
    );
    return wrote(
      ctx.session,
      `${res.succeeded ?? 0} of ${res.total ?? rows.length} added; ${res.failed ?? 0} failed.` +
        (res.failures.length ? `\nFailures: ${JSON.stringify(res.failures)}` : ""),
      {
        total: res.total,
        succeeded: res.succeeded,
        failed: res.failed,
        failures: res.failures,
        simulated: res.simulated,
      },
    );
  },
};

export const approveMember: ToolDef = {
  name: "nimbio_approve_member",
  title: "Approve a pending member",
  description:
    "Approve someone waiting to join and give them their keys. Use dry_run first to see what " +
    "would happen without doing it. account_community_id comes from nimbio_list_members " +
    "(the pending bucket).",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  capability: "members",
  inputSchema: {
    account_community_id: z.number().int(),
    key_ids: z.array(z.string()).describe("Keys to grant on approval."),
    move_out_date: z.string().optional().describe("YYYY-MM-DD, if their tenancy has an end."),
    dry_run: z.boolean().optional().describe("Report what would happen and change nothing."),
  },
  endpoints: ["POST /v1/community/members/{}/approve"],
  async handler(ctx, args) {
    const res = await ctx.client.community.approveMember(
      args.account_community_id as number,
      args.key_ids as string[],
      {
        moveOutDate: args.move_out_date as string | undefined,
        dryRun: args.dry_run as boolean | undefined,
      },
    );
    return wrote(
      ctx.session,
      args.dry_run
        ? `Dry run — member ${args.account_community_id} would be approved with ${(args.key_ids as string[]).length} key(s).`
        : `Member ${args.account_community_id} approved with ${(args.key_ids as string[]).length} key(s).`,
      { result: res.result, request_id: res.requestId, simulated: res.simulated },
    );
  },
};

export const manageMemberKeys: ToolDef = {
  name: "nimbio_manage_member_keys",
  title: "Grant, revoke, disable or enable members' keys",
  description:
    "Change who can open what. grant adds keys, revoke removes them, disable/enable toggle " +
    "without removing. Pass one member or many — many uses the bulk endpoint. Revoking with " +
    "remove_member also removes the person from the community. Disabling is reversible and " +
    "usually the right first move; revoking is not.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: "members",
  inputSchema: {
    action: z.enum(["grant", "revoke", "disable", "enable"]),
    members: z
      .array(
        z.object({
          account_community_id: z.number().int(),
          key_ids: z.array(z.string()),
        }),
      )
      .min(1),
    remove_member: z
      .boolean()
      .optional()
      .describe("revoke only: also remove the person from the community."),
  },
  endpoints: [
    "POST /v1/community/members/{}/grant-keys",
    "POST /v1/community/members/{}/revoke-keys",
    "POST /v1/community/members/{}/keys-disabled",
    "POST /v1/community/members/keys/bulk-grant",
    "POST /v1/community/members/keys/bulk-revoke",
    "POST /v1/community/members/keys/bulk-disabled",
  ],
  async handler(ctx, args) {
    const c = ctx.client.community;
    const rows = args.members as { account_community_id: number; key_ids: string[] }[];
    const action = args.action as string;
    const single = rows.length === 1 ? rows[0]! : null;

    if (single) {
      if (action === "grant") {
        const r = await c.grantKeys(single.account_community_id, single.key_ids);
        return wrote(ctx.session, `Granted ${single.key_ids.length} key(s).`, {
          result: r.result,
          simulated: r.simulated,
        });
      }
      if (action === "revoke") {
        const r = await c.revokeKeys(single.account_community_id, single.key_ids, {
          removeMember: args.remove_member as boolean | undefined,
        });
        return wrote(
          ctx.session,
          `Revoked ${single.key_ids.length} key(s)` +
            (args.remove_member ? " and removed the member." : "."),
          { result: r.result, simulated: r.simulated },
        );
      }
      const r = await c.setKeysDisabled(
        single.account_community_id,
        single.key_ids,
        action === "disable",
      );
      return wrote(ctx.session, `${action === "disable" ? "Disabled" : "Enabled"} ${single.key_ids.length} key(s).`, {
        result: r.result,
        simulated: r.simulated,
      });
    }

    const items = rows.map((r) => ({
      accountCommunityId: r.account_community_id,
      keyIds: r.key_ids,
    }));
    const res =
      action === "grant"
        ? await c.bulkGrantKeys(items)
        : action === "revoke"
          ? await c.bulkRevokeKeys(items)
          : await c.bulkSetKeysDisabled(items, action === "disable");
    return wrote(
      ctx.session,
      `${res.succeeded ?? 0} of ${res.total ?? rows.length} succeeded; ${res.failed ?? 0} failed.`,
      {
        total: res.total,
        succeeded: res.succeeded,
        failed: res.failed,
        failures: res.failures,
        simulated: res.simulated,
      },
    );
  },
};

export const updateKey: ToolDef = {
  name: "nimbio_update_key",
  title: "Rename or disable a key",
  description:
    "Rename a community key, or disable/enable it. Disabling a key stops it opening anything " +
    "without destroying it or its history. The response reports how many descendant keys the " +
    "change reaches — sharing mints child keys, so one key can have many.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  capability: "members",
  inputSchema: {
    key_id: z.string(),
    name: z.string().optional(),
    disabled: z.boolean().optional(),
  },
  endpoints: ["PATCH /v1/community/keys/{}"],
  async handler(ctx, args) {
    const res = await ctx.client.community.updateKey(args.key_id as string, {
      name: args.name as string | undefined,
      disabled: args.disabled as boolean | undefined,
    });
    return wrote(
      ctx.session,
      `Key ${res.keyId} updated` +
        (res.descendantKeyCount ? ` (affects ${res.descendantKeyCount} descendant key(s))` : "") +
        ".",
      {
        key_id: res.keyId,
        descendant_key_count: res.descendantKeyCount,
        would_set: res.wouldSet,
        result: res.result,
        simulated: res.simulated,
      },
    );
  },
};

export const setKeySchedule: ToolDef = {
  name: "nimbio_set_key_schedule",
  title: "Set a key's access schedule",
  description:
    "Replace the hours during which a key may open gates. This REPLACES the whole schedule — " +
    "send every window you want, not just the new one. Pass null windows to clear the schedule " +
    "and make the key unrestricted. Read nimbio://schedule-rules: days are MTWHFSU with H for " +
    "Thursday, times are community-local, and no window may wrap past midnight.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  capability: "key_schedules",
  inputSchema: {
    key_id: z.string(),
    windows: z
      .array(
        z.object({
          days_of_the_week: z.string().describe("Letters from MTWHFSU; H=Thursday, S=Saturday, U=Sunday."),
          start_time: z.string().describe('HH:MM, community-local. Use "24:00" for end-of-day.'),
          end_time: z.string().describe("HH:MM, community-local. Must not wrap past midnight."),
        }),
      )
      .nullable()
      .describe("The complete schedule. null clears it, making the key unrestricted."),
  },
  endpoints: ["PUT /v1/community/keys/{}/schedule"],
  async handler(ctx, args) {
    const windows = args.windows as
      | { days_of_the_week: string; start_time: string; end_time: string }[]
      | null;
    const res = await ctx.client.community.setKeySchedule(
      args.key_id as string,
      windows === null
        ? null
        : windows.map((w) => ({
            daysOfTheWeek: w.days_of_the_week,
            startTime: w.start_time,
            endTime: w.end_time,
          })),
    );
    return wrote(
      ctx.session,
      windows === null
        ? `Schedule cleared — key ${res.keyId} is now unrestricted.`
        : `Key ${res.keyId} now has ${res.windows.length} window(s).`,
      { key_id: res.keyId, restricted: res.restricted, windows: res.windows },
    );
  },
};
