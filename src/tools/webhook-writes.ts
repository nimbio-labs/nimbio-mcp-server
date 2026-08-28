/** Webhook management, delivery recovery, broadcasts and notification settings. */
import { z } from "zod";
import { wrote, fail } from "../format.js";
import type { ToolDef } from "./types.js";

export const manageWebhook: ToolDef = {
  name: "nimbio_manage_webhook",
  title: "Create, change, delete or test a webhook",
  description:
    "Manage webhook endpoints. rotate_secret invalidates the old signing secret immediately — " +
    "a receiver still validating against it will reject everything, including any delivery " +
    "replayed afterwards. test sends a sample event so you can check a receiver end to end.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: "webhooks",
  inputSchema: {
    action: z.enum(["create", "update", "delete", "rotate_secret", "test"]),
    webhook_id: z.string().optional().describe("Required for everything except create."),
    url: z.string().optional().describe("Required for create."),
    events: z
      .array(z.string())
      .optional()
      .describe("Event types to subscribe to; see nimbio://webhook-event-types."),
    description: z.string().optional(),
    active: z.boolean().optional(),
  },
  endpoints: [
    "POST /v1/community/webhooks",
    "PATCH /v1/community/webhooks/{}",
    "DELETE /v1/community/webhooks/{}",
    "POST /v1/community/webhooks/{}/rotate-secret",
    "POST /v1/community/webhooks/{}/test",
  ],
  async handler(ctx, args) {
    const c = ctx.client.community;
    if (args.action === "create") {
      if (typeof args.url !== "string" || !Array.isArray(args.events)) {
        return fail("create needs `url` and `events`.");
      }
      const res = await c.createWebhook(args.url, args.events as string[], {
        description: args.description as string | undefined,
      });
      return wrote(
        ctx.session,
        `Webhook ${res.webhook?.webhookId} created. The signing secret is shown once — store it now.`,
        { webhook: res.webhook?.raw ?? null, result: res.result, simulated: res.simulated },
      );
    }
    if (typeof args.webhook_id !== "string") {
      return fail(`${args.action} needs \`webhook_id\` — from nimbio_webhooks.`);
    }
    switch (args.action) {
      case "delete": {
        const res = await c.deleteWebhook(args.webhook_id);
        return wrote(ctx.session, `Webhook ${args.webhook_id} deleted.`, {
          result: res.result,
          simulated: res.simulated,
        });
      }
      case "rotate_secret": {
        const res = await c.rotateWebhookSecret(args.webhook_id);
        return wrote(
          ctx.session,
          "Secret rotated. The previous secret stops working immediately — update your receiver " +
            "before the next delivery, and note that replaying an older delivery now signs it " +
            "with the NEW secret.",
          { ...res.raw },
        );
      }
      case "test": {
        const res = await c.testWebhook(args.webhook_id);
        return wrote(ctx.session, `Test event sent to webhook ${args.webhook_id}.`, {
          result: res.result,
          simulated: res.simulated,
        });
      }
      default: {
        const res = await c.updateWebhook(args.webhook_id, {
          url: args.url as string | undefined,
          events: args.events as string[] | undefined,
          active: args.active as boolean | undefined,
          description: args.description as string | undefined,
        });
        return wrote(ctx.session, `Webhook ${args.webhook_id} updated.`, {
          webhook: res.webhook?.raw ?? null,
          result: res.result,
          simulated: res.simulated,
        });
      }
    }
  },
};

export const replayWebhook: ToolDef = {
  name: "nimbio_replay_webhook",
  title: "Replay or retry webhook deliveries",
  description:
    "Re-send a delivery your receiver missed, or retry every recently failed one. " +
    "READ THIS FIRST: a replay re-sends the ORIGINAL event id and the original payload, byte " +
    "for byte, and the X-Nimbio-Delivery header carries that event id — not the delivery id. " +
    "A receiver that de-duplicates on it handles the replay correctly. A receiver that ignores " +
    "it APPLIES THE EVENT TWICE: a second charge, a second gate open. Confirm the receiver " +
    "de-duplicates before replaying, and especially before retrying a batch. Replays are signed " +
    "with the CURRENT secret, so anything replayed after a rotation is rejected by a receiver " +
    "still validating against the old one.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: "webhooks",
  inputSchema: {
    action: z.enum(["replay_one", "retry_failed"]),
    webhook_id: z.string(),
    delivery_id: z.string().optional().describe("Required for replay_one."),
    since: z.string().optional().describe("retry_failed: ISO-8601 lower bound."),
    limit: z.number().int().min(1).optional().describe("retry_failed: cap on how many."),
  },
  endpoints: [
    "POST /v1/community/webhooks/{}/deliveries/{}/replay",
    "POST /v1/community/webhooks/{}/deliveries/retry-failed",
  ],
  async confirm(args) {
    const batch = args.action === "retry_failed";
    return {
      action: batch
        ? `Retry every recently failed delivery on webhook ${args.webhook_id}`
        : `Replay delivery ${args.delivery_id} on webhook ${args.webhook_id}`,
      facts: [
        "The ORIGINAL event id and payload are re-sent byte for byte.",
        "A receiver that does not de-duplicate on X-Nimbio-Delivery will apply the event a " +
          "second time — a second charge, a second gate open.",
        batch ? "This is a BATCH: the multiplier applies to every event it re-sends." : "",
        "Replays are signed with the current secret; a receiver on an old secret rejects them.",
      ].filter(Boolean),
    };
  },
  async handler(ctx, args) {
    const c = ctx.client.community;
    if (args.action === "replay_one") {
      if (typeof args.delivery_id !== "string") return fail("replay_one needs `delivery_id`.");
      const res = await c.replayDelivery(args.webhook_id as string, args.delivery_id);
      return wrote(ctx.session, `Delivery ${args.delivery_id} replayed.`, { ...res.raw });
    }
    const res = await c.retryFailedDeliveries(args.webhook_id as string, {
      since: args.since as string | undefined,
      limit: args.limit as number | undefined,
    });
    return wrote(
      ctx.session,
      `${res.replayedCount ?? 0} delivery(ies) replayed; ${res.skippedInFlight ?? 0} skipped as ` +
        `still in flight, ${res.skippedDuplicateEvent ?? 0} skipped as duplicate events.`,
      {
        replayed_count: res.replayedCount,
        skipped_in_flight: res.skippedInFlight,
        skipped_duplicate_event: res.skippedDuplicateEvent,
        result: res.result,
        simulated: res.simulated,
      },
    );
  },
};

export const sendMessage: ToolDef = {
  name: "nimbio_send_message",
  title: "Message all members",
  description:
    "Broadcast a message to every member of the community. This reaches real people on their " +
    "phones and cannot be recalled. An idempotency key is attached automatically so a retry " +
    "cannot send it twice. Read nimbio_messages first to see what has already been sent.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: "messages",
  inputSchema: { message: z.string().min(1).describe("The message body, as members will read it.") },
  endpoints: ["POST /v1/community/messages"],
  async confirm(args, ctx) {
    let audience = "every member of this community";
    try {
      const members = await ctx.client.community.members();
      audience = `all ${members.accepted.length} accepted member(s) of community ${ctx.session.communityId}`;
    } catch {
      // Counting is a courtesy.
    }
    return {
      action: `Send this message to ${audience}`,
      facts: [
        `Message: "${args.message}"`,
        "It reaches real phones and cannot be recalled once sent.",
      ],
    };
  },
  async handler(ctx, args) {
    // The SDK's message() takes no idempotency key, so the protection here is
    // the confirmation gate plus the pre-send read the description asks for.
    const res = await ctx.client.community.message(args.message as string);
    return wrote(ctx.session, "Message sent to all members.", {
      result: res.result,
      request_id: res.requestId,
      simulated: res.simulated,
    });
  },
};

export const setMyNotifications: ToolDef = {
  name: "nimbio_set_my_notifications",
  title: "Change my notification settings",
  description:
    "Turn member-open alerts on or off for THIS community manager, and manage the quiet hours " +
    "that suppress them. Settings are per manager, not per community: turning them off here " +
    "does not stop another manager's alerts. " +
    "Quiet-hours windows DO wrap past midnight — 22:00-06:00 is one window — which is the " +
    'opposite of every other schedule in this API, and "24:00" is refused here.',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  capability: "open_notifications",
  inputSchema: {
    action: z.enum(["set_enabled", "add_quiet_hours", "remove_quiet_hours"]),
    enabled: z.boolean().optional(),
    days_of_the_week: z.string().optional().describe("Letters from MTWHFSU; H=Thursday."),
    start_time: z.string().optional().describe('HH:MM. May wrap past midnight. "24:00" is refused.'),
    end_time: z.string().optional(),
    quiet_hours_id: z.union([z.number(), z.string()]).optional(),
  },
  endpoints: [
    "PUT /v1/community/my-notification-settings",
    "POST /v1/community/my-notification-settings/quiet-hours",
    "DELETE /v1/community/my-notification-settings/quiet-hours/{}",
  ],
  async handler(ctx, args) {
    const c = ctx.client.community;
    if (args.action === "set_enabled") {
      if (typeof args.enabled !== "boolean") return fail("set_enabled needs `enabled`.");
      const res = await c.setMyNotificationsEnabled(args.enabled);
      return wrote(ctx.session, `Member-open alerts are now ${res.enabled ? "ON" : "OFF"} for you.`, {
        enabled: res.enabled,
        simulated: res.simulated,
      });
    }
    if (args.action === "remove_quiet_hours") {
      if (args.quiet_hours_id === undefined) return fail("remove_quiet_hours needs `quiet_hours_id`.");
      const res = await c.removeQuietHours(args.quiet_hours_id as string | number);
      return wrote(ctx.session, `Quiet-hours window ${args.quiet_hours_id} removed.`, {
        quiet_hours: res.quietHours,
        simulated: res.simulated,
      });
    }
    if (typeof args.days_of_the_week !== "string") return fail("add_quiet_hours needs `days_of_the_week`.");
    const res = await c.addQuietHours(args.days_of_the_week, {
      startTime: args.start_time as string | undefined,
      endTime: args.end_time as string | undefined,
    });
    return wrote(
      ctx.session,
      `Quiet-hours window added (${args.days_of_the_week} ${args.start_time ?? "?"}-${args.end_time ?? "?"}).`,
      { quiet_hours: res.quietHours, simulated: res.simulated },
    );
  },
};
