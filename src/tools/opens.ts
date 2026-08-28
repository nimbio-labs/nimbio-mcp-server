/** Opening gates — the tools with a physical consequence. */
import { z } from "zod";
import { wrote } from "../format.js";
import { idempotencyKey } from "../idempotency.js";
import type { ToolDef } from "./types.js";

export const openGate: ToolDef = {
  name: "nimbio_open_gate",
  title: "Open a gate",
  description:
    "Physically open one of this community's gates. The call blocks until the gate confirms, " +
    "is denied, or fails to confirm within about 15 seconds. An idempotency key is attached " +
    "automatically, so a retry of the identical call replays the first result rather than " +
    "opening the gate a second time. Get latch_id from nimbio_gate_status or nimbio_list_gates.",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  capability: "open",
  inputSchema: {
    latch_id: z.string().describe("The gate to open, from nimbio_gate_status."),
    note: z.string().optional().describe("Recorded against the open in the access log."),
  },
  endpoints: ["POST /v1/community/latches/{}/open"],
  async confirm(args, ctx) {
    let name = args.latch_id as string;
    try {
      const status = await ctx.client.community.gateStatus();
      const match = status.latches.find((l) => l.latchId === args.latch_id);
      if (match?.latchName) name = `${match.latchName} (${args.latch_id})`;
    } catch {
      // Naming is a courtesy; never block the confirmation on it.
    }
    return {
      action: `Open the gate: ${name}`,
      facts: [
        `Community ${ctx.session.communityId ?? "(unknown)"}`,
        args.note ? `Note recorded in the access log: "${args.note}"` : "No note recorded.",
        "The open is logged against this API key and is visible in the access log.",
      ],
    };
  },
  async handler(ctx, args) {
    const res = await ctx.client.community.open(args.latch_id as string, {
      note: args.note as string | undefined,
      idempotencyKey: idempotencyKey(),
    });
    const structured = {
      opened: res.opened,
      result: res.result,
      latch_id: res.latchId,
      request_id: res.requestId,
      simulated: res.simulated,
    };
    return wrote(
      ctx.session,
      res.opened
        ? `Gate ${res.latchId} opened.`
        : `Gate ${res.latchId} did not report open (result: ${res.result ?? "unknown"}).`,
      structured,
    );
  },
};

export const openMyGate: ToolDef = {
  name: "nimbio_open_my_gate",
  title: "Open one of my gates",
  description:
    "Open a gate using one of this account's own keys. Account-scoped equivalent of " +
    "nimbio_open_gate; get key_id and latch_id from nimbio_my_keys.",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  scope: "account",
  capability: "open",
  inputSchema: {
    key_id: z.string().describe("Which of your keys to use, from nimbio_my_keys."),
    latch_id: z.string().describe("The gate to open, from nimbio_my_keys."),
    note: z.string().optional(),
  },
  endpoints: ["POST /v1/account/keys/{}/latches/{}/open"],
  async confirm(args) {
    return {
      action: `Open gate ${args.latch_id} with key ${args.key_id}`,
      facts: ["The open is logged against this account and this API key."],
    };
  },
  async handler(ctx, args) {
    const res = await ctx.client.account.open(args.key_id as string, args.latch_id as string, {
      note: args.note as string | undefined,
      idempotencyKey: idempotencyKey(),
    });
    return wrote(
      ctx.session,
      res.opened ? `Gate ${res.latchId} opened.` : `Gate did not open (${res.result ?? "unknown"}).`,
      {
        opened: res.opened,
        result: res.result,
        latch_id: res.latchId,
        request_id: res.requestId,
        simulated: res.simulated,
      },
    );
  },
};
