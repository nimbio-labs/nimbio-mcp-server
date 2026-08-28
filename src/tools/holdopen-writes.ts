/**
 * Hold-open writes.
 *
 * Every schedule here obeys the rules in nimbio://schedule-rules: MTWHFSU where
 * H is Thursday, times in the latch's own local timezone, and no window may wrap
 * past midnight.
 */
import { z } from "zod";
import { wrote, fail } from "../format.js";
import type { ToolDef } from "./types.js";

const DAYS_DESC =
  "Letters from MTWHFSU. H is Thursday, S is Saturday, U is Sunday — not what the initials " +
  "suggest.";
const TIME_DESC =
  "HH:MM in the LATCH's own local timezone, never UTC. A window may not wrap past midnight: " +
  'split 22:00-06:00 into two, ending the first at "24:00" (not "23:59") so they leave no gap.';

export const setHoldOpen: ToolDef = {
  name: "nimbio_set_hold_open",
  title: "Hold a gate open (or stop)",
  description:
    "Hold a gate open indefinitely, release it, or suspend its hold-open schedules until a " +
    "given time. An indefinite hold leaves the gate standing open until something clears it — " +
    "this is the setting most likely to be left on by accident.",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: "hold_opens",
  inputSchema: {
    latch_id: z.string(),
    action: z
      .enum(["hold", "release", "suspend_schedules", "resume_schedules"])
      .describe(
        "hold/release set the manual indefinite hold. suspend_schedules pauses this latch's " +
          "hold-open schedules until `until`; resume_schedules clears that suspension.",
      ),
    until: z
      .string()
      .optional()
      .describe("ISO-8601 timestamp; required for suspend_schedules."),
  },
  endpoints: [
    "PUT /v1/community/latches/{}/hold-open",
    "PUT /v1/community/latches/{}/hold-open/disabled-until",
  ],
  async confirm(args) {
    const map: Record<string, string> = {
      hold: `Hold gate ${args.latch_id} OPEN indefinitely`,
      release: `Release the indefinite hold on gate ${args.latch_id}`,
      suspend_schedules: `Suspend hold-open schedules on gate ${args.latch_id} until ${args.until}`,
      resume_schedules: `Resume hold-open schedules on gate ${args.latch_id}`,
    };
    return {
      action: map[args.action as string] ?? `Change hold open on ${args.latch_id}`,
      facts:
        args.action === "hold"
          ? [
              "The gate will stand open until something clears it — there is no automatic timeout.",
              "Anyone can walk or drive through while it is held.",
            ]
          : ["This changes the hold-open configuration, not the gate's current physical position."],
    };
  },
  async handler(ctx, args) {
    const c = ctx.client.community;
    const latchId = args.latch_id as string;
    switch (args.action) {
      case "hold":
      case "release": {
        const res = await c.setHoldOpen(latchId, args.action === "hold");
        return wrote(
          ctx.session,
          `Gate ${res.latchId}: manual hold ${res.heldOpen ? "ON" : "OFF"}.`,
          {
            latch_id: res.latchId,
            held_open: res.heldOpen,
            manual: res.manual,
            result: res.result,
            simulated: res.simulated,
          },
        );
      }
      case "suspend_schedules": {
        if (typeof args.until !== "string") {
          return fail("suspend_schedules needs `until` — an ISO-8601 timestamp to suspend through.");
        }
        const res = await c.setHoldOpenDisabledUntil(latchId, args.until);
        return wrote(ctx.session, `Hold-open schedules suspended until ${args.until}.`, {
          ...res.raw,
          simulated: res.simulated,
        });
      }
      default: {
        const res = await c.setHoldOpenDisabledUntil(latchId, null);
        return wrote(ctx.session, "Hold-open schedules resumed.", {
          ...res.raw,
          simulated: res.simulated,
        });
      }
    }
  },
};

export const addHoldOpenWindow: ToolDef = {
  name: "nimbio_add_hold_open_window",
  title: "Add a timed hold-open window",
  description:
    "Hold a gate open between two specific timestamps — a one-off, for a delivery or an event. " +
    "For a weekly repeat use nimbio_manage_recurring_hold_open instead.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  capability: "hold_opens",
  inputSchema: {
    latch_id: z.string(),
    start: z.string().describe("ISO-8601 start."),
    end: z.string().describe("ISO-8601 end."),
  },
  endpoints: ["POST /v1/community/latches/{}/hold-open/events"],
  async handler(ctx, args) {
    const res = await ctx.client.community.addHoldOpenEvent(args.latch_id as string, {
      start: args.start as string,
      end: args.end as string,
    });
    return wrote(
      ctx.session,
      `Window added on ${res.latchId}: ${args.start} to ${args.end} (event ${res.eventId}).`,
      { event_id: res.eventId, latch_id: res.latchId, result: res.result, simulated: res.simulated },
    );
  },
};

export const removeHoldOpenWindow: ToolDef = {
  name: "nimbio_remove_hold_open_window",
  title: "Remove a timed hold-open window",
  description: "Delete a one-off hold-open window by its event id, from nimbio_hold_opens.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: "hold_opens",
  inputSchema: { latch_id: z.string(), event_id: z.string() },
  endpoints: ["DELETE /v1/community/latches/{}/hold-open/events/{}"],
  async handler(ctx, args) {
    const res = await ctx.client.community.removeHoldOpenEvent(
      args.latch_id as string,
      args.event_id as string,
    );
    return wrote(ctx.session, `Window ${args.event_id} removed from ${args.latch_id}.`, {
      ...res.raw,
      simulated: res.simulated,
    });
  },
};

export const manageRecurringHoldOpen: ToolDef = {
  name: "nimbio_manage_recurring_hold_open",
  title: "Recurring hold-open schedules",
  description:
    "Add, change or delete a weekly recurring hold open — the gate opens on the same days and " +
    "hours every week. Read nimbio://schedule-rules first: the day letters and the " +
    "no-midnight-wrap rule both fail silently when got wrong. Deleting is deliberately NOT " +
    "idempotent: an id that is not on that latch raises rather than succeeding quietly, " +
    "because a silent success would let you believe you had cancelled a schedule that is still " +
    "holding a gate open.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: "hold_opens",
  inputSchema: {
    latch_id: z.string(),
    action: z.enum(["add", "update", "remove"]),
    temporal_date_id: z.string().optional().describe("Required for update and remove."),
    days_of_the_week: z.string().optional().describe(DAYS_DESC),
    start_time: z.string().optional().describe(TIME_DESC),
    end_time: z.string().optional().describe(TIME_DESC),
    recurring_week: z.number().int().optional().describe("Week interval; 1 means every week."),
  },
  endpoints: [
    "POST /v1/community/latches/{}/hold-open/recurring",
    "PATCH /v1/community/latches/{}/hold-open/recurring/{}",
    "DELETE /v1/community/latches/{}/hold-open/recurring/{}",
  ],
  async handler(ctx, args) {
    const c = ctx.client.community;
    const latchId = args.latch_id as string;
    if (args.action === "remove") {
      if (typeof args.temporal_date_id !== "string") {
        return fail("remove needs temporal_date_id — get it from nimbio_hold_opens.");
      }
      const res = await c.removeHoldOpenRecurring(latchId, args.temporal_date_id);
      return wrote(ctx.session, `Recurring schedule ${args.temporal_date_id} removed.`, {
        ...res.raw,
        simulated: res.simulated,
      });
    }
    if (args.action === "update") {
      if (typeof args.temporal_date_id !== "string") {
        return fail("update needs temporal_date_id — get it from nimbio_hold_opens.");
      }
      const res = await c.updateHoldOpenRecurring(latchId, args.temporal_date_id, {
        daysOfTheWeek: args.days_of_the_week as string | undefined,
        startTime: args.start_time as string | undefined,
        endTime: args.end_time as string | undefined,
        recurringWeek: args.recurring_week as number | undefined,
      });
      return wrote(ctx.session, `Recurring schedule ${res.temporalDateId} updated.`, {
        temporal_date_id: res.temporalDateId,
        schedule: res.schedule,
        result: res.result,
        simulated: res.simulated,
      });
    }
    if (typeof args.days_of_the_week !== "string") {
      return fail("add needs days_of_the_week — letters from MTWHFSU, where H is Thursday.");
    }
    const res = await c.addHoldOpenRecurring(latchId, args.days_of_the_week, {
      startTime: args.start_time as string | undefined,
      endTime: args.end_time as string | undefined,
      recurringWeek: args.recurring_week as number | undefined,
    });
    return wrote(
      ctx.session,
      `Recurring schedule ${res.temporalDateId} added on ${res.latchId} ` +
        `(${args.days_of_the_week} ${args.start_time ?? "?"}-${args.end_time ?? "?"}, latch-local time).`,
      {
        temporal_date_id: res.temporalDateId,
        latch_id: res.latchId,
        schedule: res.schedule,
        result: res.result,
        simulated: res.simulated,
      },
    );
  },
};
