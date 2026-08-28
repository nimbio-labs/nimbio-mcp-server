/** Webhooks, delivery inspection, messages and per-manager notification settings. */
import { z } from "zod";
import { ok } from "../format.js";
import type { ToolDef } from "./types.js";

export const webhooks: ToolDef = {
  name: "nimbio_webhooks",
  title: "List webhooks",
  description:
    "Webhook endpoints registered for this community: where each posts, which events it " +
    "subscribes to, and whether it is active. Optionally the full list of event types the API " +
    "can send — that list is authoritative at runtime, so prefer it over any hard-coded set. " +
    "Secrets are never returned after creation.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "webhooks",
  inputSchema: {
    include_event_types: z
      .boolean()
      .optional()
      .describe("Also fetch every event type a webhook may subscribe to."),
  },
  endpoints: ["GET /v1/community/webhooks", "GET /v1/community/webhook-events"],
  async handler(ctx, args) {
    const c = ctx.client.community;
    const hooks = await c.webhooks();
    const types = args.include_event_types ? await c.webhookEventTypes() : null;
    const structured = {
      webhooks: hooks.map((w) => ({
        webhook_id: w.webhookId,
        url: w.url,
        events: w.events,
        description: w.description,
        active: w.active,
        disabled: w.disabled,
      })),
      event_types: types,
    };
    return ok(
      ctx.session,
      `${hooks.length} webhook(s):\n` +
        hooks
          .map(
            (w) =>
              `- [${w.webhookId}] ${w.url} — ${w.events.length} event(s)` +
              `${w.disabled ? " DISABLED" : w.active === false ? " inactive" : ""}`,
          )
          .join("\n"),
      structured,
    );
  },
};

export const webhookDeliveries: ToolDef = {
  name: "nimbio_webhook_deliveries",
  title: "Webhook deliveries",
  description:
    "Recent delivery attempts for one webhook, with their status. Use this to find out why a " +
    "consumer never saw an event before reaching for a replay.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "webhooks",
  inputSchema: {
    webhook_id: z.string().describe("From nimbio_webhooks."),
    limit: z.number().int().min(1).max(500).optional(),
  },
  endpoints: ["GET /v1/community/webhooks/{}/deliveries"],
  async handler(ctx, args) {
    const rows = await ctx.client.community.webhookDeliveries(args.webhook_id as string, {
      limit: args.limit as number | undefined,
    });
    const structured = { deliveries: rows.map((d) => d.raw) };
    return ok(ctx.session, `${rows.length} delivery attempt(s).`, structured);
  },
};

export const messages: ToolDef = {
  name: "nimbio_messages",
  title: "Sent messages",
  description:
    "Messages already broadcast to this community's members, newest first, with who sent each " +
    "and when. Read this before sending another — it is the only way to see whether the thing " +
    "you are about to say has already been said.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "messages",
  inputSchema: {
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  },
  endpoints: ["GET /v1/community/messages"],
  async handler(ctx, args) {
    const page = await ctx.client.community.messages({
      limit: args.limit as number | undefined,
      offset: args.offset as number | undefined,
    });
    const structured = {
      has_more: page.hasMore,
      messages: page.messages.map((m) => ({
        message_id: m.messageId,
        message: m.message,
        sender: m.senderName,
        sent_at: m.sentAt,
      })),
    };
    return ok(
      ctx.session,
      `${page.messages.length} message(s)${page.hasMore ? " (more available)" : ""}:\n` +
        page.messages
          .slice(0, 20)
          .map((m) => `- ${m.sentAt} ${m.senderName ?? "?"}: ${(m.message ?? "").slice(0, 120)}`)
          .join("\n"),
      structured,
    );
  },
};

export const myNotificationSettings: ToolDef = {
  name: "nimbio_my_notification_settings",
  title: "My notification settings",
  description:
    "Whether this community manager gets alerted when a member opens a gate, and the quiet " +
    "hours that suppress those alerts. These settings are per community manager, not per " +
    "community: an API key acts as its owning manager, so this always reads that person's " +
    "settings, and a community with several managers has several independent ones.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "open_notifications",
  endpoints: ["GET /v1/community/my-notification-settings"],
  async handler(ctx) {
    const s = await ctx.client.community.myNotificationSettings();
    const structured = {
      enabled: s.enabled,
      feature_available: s.featureAvailable,
      quiet_hours: s.quietHours.map((q) => ({
        quiet_hours_id: q.quietHoursId,
        days_of_the_week: q.daysOfTheWeek,
        start_time: q.startTime,
        end_time: q.endTime,
      })),
    };
    return ok(
      ctx.session,
      [
        `Member-open alerts are ${s.enabled ? "ON" : "OFF"} for this manager` +
          `${s.featureAvailable ? "" : " (the feature is not available in this community)"}.`,
        `${s.quietHours.length} quiet-hours window(s)` +
          (s.quietHours.length
            ? `: ${s.quietHours.map((q) => `${q.daysOfTheWeek} ${q.startTime}-${q.endTime}`).join(", ")}`
            : "."),
        "Note quiet-hours windows may wrap past midnight — 22:00-06:00 is one window here, " +
          "unlike every other schedule in this API.",
      ].join("\n"),
      structured,
    );
  },
};
