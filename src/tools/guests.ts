/**
 * Guest access — the family integrators reach for first: let a visitor,
 * contractor or delivery through without giving them an account.
 */
import { z } from "zod";
import { ok } from "../format.js";
import { redactLink, REDACTION_NOTE } from "../redact.js";
import type { ToolDef } from "./types.js";

const revealArg = z
  .boolean()
  .optional()
  .describe(
    "Return the guest-link token and URL in full. Each one opens the gate on its own — no " +
      "account, no key, no login — so this writes a working gate credential into the " +
      "conversation. Leave unset unless you are about to send the link to someone.",
  );

export const listGuestLinks: ToolDef = {
  name: "nimbio_list_guest_links",
  title: "List guest links",
  description:
    "Guest links issued for this community, their state (active, upcoming, expired, spent, " +
    "revoked) and how many opens each has been used for. Optionally the attempt history, and " +
    "the gates guest links may never cover. Tokens and URLs are redacted by default.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "guest_links",
  inputSchema: {
    include_inactive: z.boolean().optional().describe("Include expired, spent and revoked links."),
    include_logs: z.boolean().optional().describe("Also fetch recent guest-link attempts."),
    include_exclusions: z
      .boolean()
      .optional()
      .describe("Also fetch which gates are excluded from guest links."),
    guest_link_id: z.union([z.number(), z.string()]).optional().describe("Filter logs to one link."),
    limit: z.number().int().min(1).max(500).optional(),
    reveal: revealArg,
  },
  endpoints: [
    "GET /v1/community/guest-links",
    "GET /v1/community/guest-links/logs",
    "GET /v1/community/guest-links/latch-exclusions",
  ],
  async handler(ctx, args) {
    const c = ctx.client.community;
    const reveal = Boolean(args.reveal);
    const links = await c.guestLinks({ includeInactive: Boolean(args.include_inactive) });

    const [logs, exclusions] = await Promise.all([
      args.include_logs
        ? c.guestLinkLogs({
            guestLinkId: args.guest_link_id as never,
            limit: args.limit as number | undefined,
          })
        : Promise.resolve(null),
      args.include_exclusions ? c.guestLinkLatchExclusions() : Promise.resolve(null),
    ]);

    const structured = {
      links: links.map((l) =>
        redactLink(
          {
            guest_link_id: l.guestLinkId,
            type: l.linkType,
            state: l.state,
            title: l.title,
            key_name: l.keyName,
            latches: l.latches.map((g) => g.latchName),
            max_uses: l.maxUses,
            uses_consumed: l.usesConsumed,
            total_opens: l.totalOpens,
            token: l.token,
            url: l.url,
          },
          reveal,
        ),
      ),
      logs: logs ? logs.logs : null,
      excluded_latches: exclusions
        ? { event: exclusions.event, limited_use: exclusions.limitedUse }
        : null,
    };

    const byState = links.reduce<Record<string, number>>((acc, l) => {
      const k = l.state ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    const summary = [
      `${links.length} guest link(s): ` +
        (Object.entries(byState)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ") || "none"),
      ...links.map(
        (l) =>
          `- [${l.guestLinkId}] ${l.title ?? "(untitled)"} — ${l.state}, ${l.linkType}` +
          (l.maxUses !== null ? `, ${l.usesConsumed ?? 0}/${l.maxUses} uses` : ""),
      ),
      reveal ? null : REDACTION_NOTE,
    ]
      .filter(Boolean)
      .join("\n");
    return ok(ctx.session, summary, structured);
  },
};

export const listAccessCodes: ToolDef = {
  name: "nimbio_list_access_codes",
  title: "List access codes",
  description:
    "Numeric door codes issued to residents or visitors, which gates they open, whether they " +
    "expire or carry a schedule, and optionally their redemption history and the gates codes " +
    "are allowed to cover. Codes come back masked — the API never returns a full code after " +
    "creation.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "access_codes",
  inputSchema: {
    include_logs: z.boolean().optional().describe("Also fetch redemption attempts."),
    include_eligible_latches: z
      .boolean()
      .optional()
      .describe("Also fetch which gates access codes may open."),
    limit: z.number().int().min(1).max(500).optional(),
  },
  endpoints: [
    "GET /v1/community/access-codes",
    "GET /v1/community/access-codes/logs",
    "GET /v1/community/access-codes/eligible-latches",
  ],
  async handler(ctx, args) {
    const c = ctx.client.community;
    const codes = await c.accessCodes();
    const [logs, eligible] = await Promise.all([
      args.include_logs
        ? c.accessCodeLogs({ limit: args.limit as number | undefined })
        : Promise.resolve(null),
      args.include_eligible_latches ? c.accessCodeEligibleLatches() : Promise.resolve(null),
    ]);

    const structured = {
      feature_enabled: codes.featureEnabled,
      access_codes: codes.accessCodes.map((a) => ({
        directory_access_code_id: a.directoryAccessCodeId,
        owner: a.ownerName,
        code_masked: a.codeMasked,
        disabled: a.disabled,
        expires_at: a.expiresAt,
        has_schedule: a.hasSchedule,
        api_managed: a.apiManaged,
        latches: a.latches.map((l) => l.latchName),
      })),
      logs: logs ? logs.logs : null,
      eligible_latches: eligible ? eligible.latches.map((l) => l.latchName) : null,
    };

    if (!codes.featureEnabled) {
      return ok(
        ctx.session,
        "Directory access codes are switched off for this community. Nothing to list — the " +
          "feature flag is a Nimbio-side provisioning decision, not something this API can set.",
        structured,
      );
    }
    return ok(
      ctx.session,
      `${codes.accessCodes.length} access code(s):\n` +
        codes.accessCodes
          .map(
            (a) =>
              `- [${a.directoryAccessCodeId}] ${a.ownerName ?? "(unassigned)"} ${a.codeMasked ?? ""}` +
              `${a.disabled ? " DISABLED" : ""}${a.expiresAt ? ` expires ${a.expiresAt}` : ""}`,
          )
          .join("\n"),
      structured,
    );
  },
};

export const guestViewEntry: ToolDef = {
  name: "nimbio_guest_view_entry",
  title: "GuestView Entry",
  description:
    "Whether visitors browsing the community directory may let themselves in, which gates that " +
    "covers, and the weekly windows it is allowed during. Optionally the attempt log. Requires " +
    "directory viewing to be enabled — this reports both flags so you can tell which one is off.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "guest_view_entry",
  inputSchema: {
    include_logs: z.boolean().optional().describe("Also fetch entry attempts."),
    success: z.boolean().optional().describe("Filter the log to successes or failures only."),
    limit: z.number().int().min(1).max(500).optional(),
  },
  endpoints: ["GET /v1/community/guest-view-entry", "GET /v1/community/guest-view-entry/logs"],
  async handler(ctx, args) {
    const c = ctx.client.community;
    const gve = await c.guestViewEntry();
    const logs = args.include_logs
      ? await c.guestViewEntryLogs({
          limit: args.limit as number | undefined,
          success: args.success as boolean | undefined,
        })
      : null;
    const structured = {
      allowed: gve.allowed,
      directory_viewing_enabled: gve.directoryViewingEnabled,
      eligible_latches: gve.eligibleLatches.map((l) => ({ latch_id: l.latchId, name: l.latchName })),
      schedule: gve.schedule,
      schedule_timezone: gve.scheduleTimezone,
      logs: logs ? logs.logs : null,
    };
    return ok(
      ctx.session,
      [
        `GuestView Entry is ${gve.allowed ? "ON" : "OFF"}; directory viewing is ` +
          `${gve.directoryViewingEnabled ? "ON" : "OFF"}.`,
        `${gve.eligibleLatches.length} eligible gate(s): ` +
          (gve.eligibleLatches.map((l) => l.latchName).join(", ") || "none"),
        `${gve.schedule.length} schedule window(s), timezone ${gve.scheduleTimezone ?? "unknown"}.`,
      ].join("\n"),
      structured,
    );
  },
};

export const shortCodes: ToolDef = {
  name: "nimbio_short_codes",
  title: "Short codes",
  description:
    "Short codes map a memorable string to one gate, for signage or a printed card. Lists each " +
    "code, the gate it points at, whether it is disabled and whether it demands a security code.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "short_codes",
  endpoints: ["GET /v1/community/short-codes"],
  async handler(ctx) {
    const codes = await ctx.client.community.shortCodes();
    const structured = {
      short_codes: codes.map((s) => ({
        short_code: s.shortCode,
        latch_id: s.latchId,
        latch_name: s.latchName,
        disabled: s.disabled,
        require_security_code: s.requireSecurityCode,
      })),
    };
    return ok(
      ctx.session,
      `${codes.length} short code(s):\n` +
        codes
          .map(
            (s) =>
              `- ${s.shortCode} -> ${s.latchName ?? s.latchId}` +
              `${s.disabled ? " DISABLED" : ""}${s.requireSecurityCode ? " (security code required)" : ""}`,
          )
          .join("\n"),
      structured,
    );
  },
};
