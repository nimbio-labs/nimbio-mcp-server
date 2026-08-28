/** Starting points for the jobs the tools were grouped around. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Session } from "./session.js";

function userPrompt(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerPrompts(server: McpServer, session: Session): void {
  if (session.scope !== "community") return;

  server.registerPrompt(
    "morning_gate_check",
    {
      title: "Morning gate check",
      description:
        "Overnight health sweep: which gates are offline, what is still being held open, and " +
        "anything unusual in the access log.",
    },
    () =>
      userPrompt(
        "Give me this morning's gate check. Start with nimbio_community_overview, then " +
          "nimbio_gate_status for anything offline, nimbio_hold_opens for gates still held " +
          "open, and the last page of nimbio_access_log. Call out anything that looks wrong — " +
          "an offline gate, a hold open that should have ended, a failed open repeated by the " +
          "same person — and say plainly if nothing is wrong.",
      ),
  );

  server.registerPrompt(
    "onboard_resident",
    {
      title: "Onboard a resident",
      description: "Approve a pending member, grant them the right keys, and confirm the result.",
      argsSchema: { name: z.string().describe("The resident's name, as the manager refers to them.") },
    },
    ({ name }) =>
      userPrompt(
        `Onboard ${name}. Find them with nimbio_list_members (they are probably in the pending ` +
          "bucket), show me what you found and which keys you propose to grant before you " +
          "change anything, then approve and grant once I agree. Confirm afterwards by reading " +
          "the member back.",
      ),
  );

  server.registerPrompt(
    "investigate_after_hours_open",
    {
      title: "Investigate an after-hours open",
      description: "Work out who opened a gate outside normal hours, and whether they should have.",
      argsSchema: {
        when: z.string().describe("Roughly when, e.g. 'last night' or '2026-08-27 02:00'."),
      },
    },
    ({ when }) =>
      userPrompt(
        `Something opened a gate around ${when}. Work out what happened: check ` +
          "nimbio_access_log for the open attempts and nimbio_gate_status_log for whether the " +
          "gate physically moved — they are different records and can disagree. If a key was " +
          "used, check its schedule with nimbio_key_schedule to see whether it should have " +
          "worked at that hour, and check nimbio_change_log in case someone changed the rules " +
          "recently. Tell me what you can establish and what you cannot.",
      ),
  );

  server.registerPrompt(
    "issue_guest_access",
    {
      title: "Issue guest access",
      description: "Give a visitor a way in, choosing the right mechanism for the visit.",
      argsSchema: {
        who: z.string().describe("Who is visiting."),
        when: z.string().optional().describe("When, if it matters."),
      },
    },
    ({ who, when }) =>
      userPrompt(
        `I need to let ${who} in${when ? ` ${when}` : ""}. Look at what this community has ` +
          "available — guest links, access codes, GuestView Entry, short codes — and recommend " +
          "one, saying why it fits this visit. Check the relevant feature is actually enabled " +
          "before recommending it. Do not create anything until I agree, and when you do, do " +
          "not print the token or URL unless I ask for it.",
      ),
  );
}
