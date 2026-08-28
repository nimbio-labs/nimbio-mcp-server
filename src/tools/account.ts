/** Account-scoped reads — what an individual's own key can see. */
import { z } from "zod";
import { ok } from "../format.js";
import type { ToolDef } from "./types.js";

export const myKeys: ToolDef = {
  name: "nimbio_my_keys",
  title: "My keys",
  description:
    "The keys on this account and the gates each one opens. An account-scoped key can do " +
    "exactly one thing beyond this — open a gate — so this is the starting point for any " +
    "personal-use integration. A key marked pending is not usable yet; a disabled one will " +
    "refuse to open.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  scope: "account",
  inputSchema: {
    include_hidden: z
      .boolean()
      .optional()
      .describe("Include keys hidden from the app's default view."),
  },
  endpoints: ["GET /v1/account/keys"],
  async handler(ctx, args) {
    const keys = await ctx.client.account.keys({ includeHidden: Boolean(args.include_hidden) });
    const structured = {
      keys: keys.map((k) => ({
        key_id: k.id,
        name: k.name,
        home: k.home,
        disabled: k.disabled,
        pending: k.pending,
        hidden: k.hidden,
        shared_from: k.parentName,
        latches: k.latches.map((l) => ({
          latch_id: l.id,
          name: l.name,
          offline: l.offline,
          held_open: l.heldOpen,
        })),
      })),
    };
    const summary = keys.length
      ? keys
          .map((k) => {
            const flags = [k.disabled && "disabled", k.pending && "pending", k.hidden && "hidden"]
              .filter(Boolean)
              .join(", ");
            return `- ${k.name ?? k.id}${flags ? ` [${flags}]` : ""}: ${k.latches.length} gate(s)`;
          })
          .join("\n")
      : "No keys on this account.";
    return ok(ctx.session, `${keys.length} key(s):\n${summary}`, structured);
  },
};
