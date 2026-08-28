/**
 * The audit surface. Four trails that answer different questions and are
 * routinely confused:
 *
 *   access log       — a gate opened, and who opened it
 *   gate status log  — the gate physically moved (sensed, not commanded)
 *   change log       — someone rewrote the rule that let it open
 *   key usage        — the same opens, aggregated as a report over a date range
 */
import { z } from "zod";
import { ok } from "../format.js";
import type { ToolDef } from "./types.js";

export const accessLog: ToolDef = {
  name: "nimbio_access_log",
  title: "Access log",
  description:
    "Who opened which gate, when, and whether it worked. With account_community_id it narrows " +
    "to one member. This is the record of open *attempts* — for whether the gate physically " +
    "moved, use nimbio_gate_status_log; for who changed the rules, nimbio_change_log.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "access_logs",
  inputSchema: {
    account_community_id: z.number().int().optional().describe("Narrow to one member."),
    window: z
      .enum(["day", "week", "month"])
      .optional()
      .describe("Time window for the per-member view."),
    page: z.number().int().min(0).optional().describe("Page of the community-wide log."),
  },
  endpoints: ["GET /v1/community/access-logs", "GET /v1/community/members/{}/access-logs"],
  async handler(ctx, args) {
    const c = ctx.client.community;
    if (typeof args.account_community_id === "number") {
      const page = await c.memberAccessLogs(args.account_community_id, {
        window: args.window as never,
      });
      const structured = { logs: page.logs, raw: page.raw };
      return ok(
        ctx.session,
        `${page.logs.length} open(s) for member ${args.account_community_id}:\n` +
          page.logs
            .slice(0, 25)
            .map((l) => `- ${l.datetime} ${l.latchName} — ${l.openResult ?? l.openDesc ?? "?"}`)
            .join("\n"),
        structured,
      );
    }
    const page = await c.accessLog({ page: args.page as number | undefined });
    const structured = {
      page: page.page,
      has_more: page.hasMore,
      from: page.dateFrom,
      to: page.dateTo,
      logs: page.logs.map((l) => ({
        datetime: l.datetime,
        user: l.user,
        key_name: l.keyName,
        latch_name: l.latchName,
        result: l.openResult,
        description: l.openDesc,
        reason: l.reasonDesc,
        source: l.source,
      })),
    };
    return ok(
      ctx.session,
      `${page.logs.length} entries (page ${page.page}${page.hasMore ? ", more available" : ""}), ` +
        `${page.dateFrom ?? "?"} to ${page.dateTo ?? "?"}:\n` +
        page.logs
          .slice(0, 25)
          .map((l) => `- ${l.datetime} ${l.user ?? "?"} @ ${l.latchName ?? "?"} — ${l.openResult ?? "?"}`)
          .join("\n"),
      structured,
    );
  },
};

export const gateStatusLog: ToolDef = {
  name: "nimbio_gate_status_log",
  title: "Gate status log",
  description:
    "Physical open/closed transitions as the sense lines observed them — the gate actually " +
    "moving, which is not the same as someone commanding it to. A gate propped open shows here " +
    "and nowhere else.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "access_logs",
  inputSchema: { page: z.number().int().min(0).optional() },
  endpoints: ["GET /v1/community/gate-status-log"],
  async handler(ctx, args) {
    const page = await ctx.client.community.gateStatusLog({ page: args.page as number | undefined });
    const structured = {
      page: page.page,
      has_more: page.hasMore,
      from: page.dateFrom,
      to: page.dateTo,
      logs: page.logs.map((l) => ({
        datetime: l.datetime,
        latch_name: l.latchName,
        status: l.statusLabel,
        state: l.state,
        sense_line: l.senseLine,
      })),
    };
    return ok(
      ctx.session,
      `${page.logs.length} transition(s) (page ${page.page}${page.hasMore ? ", more" : ""}):\n` +
        page.logs
          .slice(0, 25)
          .map((l) => `- ${l.datetime} ${l.latchName ?? "?"} -> ${l.statusLabel ?? l.state ?? "?"}`)
          .join("\n"),
      structured,
    );
  },
};

export const changeLog: ToolDef = {
  name: "nimbio_change_log",
  title: "Configuration change log",
  description:
    "Who changed the community's configuration, when, and to what. Four separate trails — " +
    "hold_open, key_schedule, guest_view, guest_link — picked with `type`. Retention is 30 days " +
    "on every trail: a longer `days` is clamped rather than rejected, and nothing older is " +
    "recoverable here. Timestamps are UTC, not community-local. Note log_id is unique only " +
    "within its own trail.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "change_logs",
  inputSchema: {
    type: z
      .enum(["hold_open", "key_schedule", "guest_view", "guest_link"])
      .describe("Which trail to read."),
    days: z.number().int().min(1).optional().describe("Lookback window; clamped to 30."),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  },
  endpoints: ["GET /v1/community/change-logs"],
  async handler(ctx, args) {
    const page = await ctx.client.community.changeLogs(args.type as never, {
      days: args.days as number | undefined,
      limit: args.limit as number | undefined,
      offset: args.offset as number | undefined,
    });
    const structured = {
      log_type: page.logType,
      days: page.days,
      from: page.dateFrom,
      to: page.dateTo,
      total: page.total,
      has_more: page.hasMore,
      logs: page.logs.map((l) => ({
        log_id: l.logId,
        datetime: l.datetime,
        actor: l.accountDisplayName,
        action: l.actionType,
        summary: l.summary,
        details: l.details,
      })),
    };
    const clamped = args.days !== undefined && page.days !== null && page.days < (args.days as number);
    return ok(
      ctx.session,
      [
        `${page.logs.length} change(s) on the ${page.logType} trail, ` +
          `${page.dateFrom ?? "?"} to ${page.dateTo ?? "?"} (UTC).`,
        clamped ? `Requested ${args.days} days; clamped to ${page.days} by the 30-day retention cap.` : null,
        ...page.logs
          .slice(0, 25)
          .map((l) => `- ${l.datetime} ${l.accountDisplayName ?? "?"}: ${l.summary ?? l.actionType}`),
      ]
        .filter(Boolean)
        .join("\n"),
      structured,
    );
  },
};

export const keyUsage: ToolDef = {
  name: "nimbio_key_usage",
  title: "Key usage report",
  description:
    "Opens over a date range, as a report. from and to are YYYY-MM-DD. The range is clamped " +
    "rather than rejected if you ask for more than the API allows — the response reports the " +
    "window actually used and whether it was clamped.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "key_usage",
  inputSchema: {
    from: z.string().describe("Start date, YYYY-MM-DD."),
    to: z.string().describe("End date, YYYY-MM-DD."),
    page: z.number().int().min(0).optional(),
  },
  endpoints: ["GET /v1/community/key-usage"],
  async handler(ctx, args) {
    const report = await ctx.client.community.keyUsage(args.from as string, args.to as string, {
      page: args.page as number | undefined,
    });
    const structured = {
      report_type: report.reportType,
      residential: report.residential,
      from: report.dateFrom,
      to: report.dateTo,
      requested_from: report.requestedFrom,
      requested_to: report.requestedTo,
      clamped: report.clamped,
      max_range_days: report.maxRangeDays,
      timezone: report.timezone,
      page: report.page,
      has_more: report.hasMore,
      logs: report.logs.map((l) => ({
        datetime: l.datetime,
        user: l.user,
        key_name: l.keyName,
        latch_name: l.latchName,
        result: l.openResult,
        source: l.source,
      })),
    };
    return ok(
      ctx.session,
      [
        `${report.logs.length} open(s), ${report.dateFrom} to ${report.dateTo} ` +
          `(${report.timezone ?? "unknown timezone"}).`,
        report.clamped
          ? `Range was CLAMPED from ${report.requestedFrom}..${report.requestedTo} — ` +
            `the API caps this report at ${report.maxRangeDays} days.`
          : null,
        report.hasMore ? "More pages available." : null,
      ]
        .filter(Boolean)
        .join("\n"),
      structured,
    );
  },
};
