/**
 * Reference material the model should not spend a tool call on.
 *
 * Two of these are pure documentation — vocabularies and the schedule rules
 * that the JSON types cannot express and that are the most common source of a
 * schedule that silently never fires.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CAPABILITIES, ACCOUNT_KEY_CAPABILITIES } from "@nimbio/community-api";
import type { NimbioClient } from "@nimbio/community-api";
import type { Session } from "./session.js";

export const SCHEDULE_RULES = `# Nimbio schedule rules

These rules are not expressible in the JSON types, and getting one wrong usually
fails silently — you get a schedule that never fires rather than an error.

## Days of the week

Recurring hold opens and quiet hours both take a string of letters from
\`MTWHFSU\`:

  M = Monday     T = Tuesday    W = Wednesday
  H = Thursday   F = Friday     S = Saturday    U = Sunday

Note H, S and U. Writing "T" for Thursday or "S" for Sunday selects the wrong
day and nothing complains.

## Times and timezones

Times are \`HH:MM\` in the **latch's own local timezone** — never UTC, and never
the caller's timezone. A community spanning timezones evaluates each gate in its
own.

## Midnight, and the one exception

**Recurring hold opens and key schedules may not wrap past midnight.** Split
\`22:00\`-\`06:00\` into two windows, and use \`"24:00"\` rather than \`"23:59"\`
for the end of the first half so the two leave no gap.

**Quiet hours are the exception: they DO wrap.** \`22:00\`-\`06:00\` is a single
quiet-hours window, and \`"24:00"\` is refused there. Carrying the hold-open idiom
across produces a window that never suppresses anything.

## Deleting a recurring hold open is not idempotent

Removing a recurring schedule with an id that is not on that latch raises rather
than succeeding quietly — deliberately, because a silent success would let you
believe you had cancelled a schedule that is still holding a gate open.
`;

export function registerResources(
  server: McpServer,
  client: NimbioClient,
  session: Session,
): void {
  server.registerResource(
    "capabilities",
    "nimbio://capabilities",
    {
      title: "API key capabilities",
      description:
        "Every endpoint family an API key can be granted. Open vocabulary — the server may " +
        "add one at any time, so an unrecognised value is not an error.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              community_key_capabilities: CAPABILITIES,
              account_key_capabilities: ACCOUNT_KEY_CAPABILITIES,
              this_key: session.capabilities,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "schedule-rules",
    "nimbio://schedule-rules",
    {
      title: "Schedule rules (days, timezones, midnight)",
      description:
        "The MTWHFSU letters, latch-local timezones, the no-midnight-wrap rule and the " +
        "quiet-hours exception. Read before writing any schedule.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: SCHEDULE_RULES }],
    }),
  );

  if (session.scope === "community") {
    server.registerResource(
      "gates",
      "nimbio://gates",
      {
        title: "Gate roster",
        description: "Gate ids and names, so a gate referred to by name can be resolved.",
        mimeType: "application/json",
      },
      async (uri) => {
        const status = await client.community.gateStatus();
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                status.latches.map((l) => ({
                  latch_id: l.latchId,
                  name: l.latchName,
                  status: l.status,
                  offline: l.offline,
                })),
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerResource(
      "webhook-event-types",
      "nimbio://webhook-event-types",
      {
        title: "Webhook event types",
        description:
          "Every event type a webhook may subscribe to, read live from the API — " +
          "authoritative at runtime, unlike any hard-coded list.",
        mimeType: "application/json",
      },
      async (uri) => {
        const types = await client.community.webhookEventTypes();
        return {
          contents: [
            { uri: uri.href, mimeType: "application/json", text: JSON.stringify(types, null, 2) },
          ],
        };
      },
    );
  }
}
