/**
 * Human confirmation before anything irreversible.
 *
 * A `confirm: true` argument would be no protection at all — the model can set
 * it. So confirmation is obtained out of band, by one of two mechanisms:
 *
 *  1. **Elicitation.** Mid-call, the server asks the client to put the question
 *     to a human and waits for the answer. Requires the client to declare the
 *     `elicitation` capability.
 *
 *  2. **Two-step token.** For clients that cannot elicit: the first call returns
 *     a preview and a single-use token, and the tool acts only when called again
 *     with it. A determined model can chain both calls, but the consequence is
 *     rendered into the transcript before anything fires, and the host's own
 *     per-tool approval sits between the two calls.
 *
 * When the SDK supports protocol revision 2026-07-28, mechanism 1 becomes an
 * `input_required` tool result and mechanism 2 can be retired.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ToolResult } from "./format.js";

export const TOKEN_TTL_MS = 60_000;

interface PendingConfirmation {
  toolName: string;
  argsHash: string;
  expiresAt: number;
}

/** Live confirmation tokens. Single use, short lived, in-process only. */
const pending = new Map<string, PendingConfirmation>();

export function hashArgs(args: Record<string, unknown>): string {
  const { confirmation_token: _ignored, ...rest } = args;
  return createHash("sha256").update(JSON.stringify(rest, Object.keys(rest).sort())).digest("hex");
}

function sweep(now: number): void {
  for (const [token, entry] of pending) if (entry.expiresAt <= now) pending.delete(token);
}

/** Visible for tests. */
export function _pendingSize(): number {
  sweep(Date.now());
  return pending.size;
}

export function _clearPending(): void {
  pending.clear();
}

export interface ConfirmDetails {
  /** One line naming the consequence, e.g. "Open the North Gate". */
  action: string;
  /** Supporting facts the human needs — which community, live or test, blast radius. */
  facts: string[];
}

export type ConfirmOutcome = { ok: true } | { ok: false; result: ToolResult };

export interface ConfirmDeps {
  server: Server;
  unrestricted: boolean;
  testMode: boolean;
}

function consequenceText(details: ConfirmDetails, testMode: boolean): string {
  return [
    details.action,
    "",
    ...details.facts.map((f) => `- ${f}`),
    "",
    testMode
      ? "This key is in TEST MODE: the call will be simulated and nothing will physically happen."
      : "This key is LIVE: this will really happen.",
  ].join("\n");
}

export async function confirm(
  deps: ConfirmDeps,
  toolName: string,
  args: Record<string, unknown>,
  details: ConfirmDetails,
): Promise<ConfirmOutcome> {
  if (deps.unrestricted) return { ok: true };

  const supportsElicitation = Boolean(deps.server.getClientCapabilities()?.elicitation);

  if (supportsElicitation) {
    const res = await deps.server.elicitInput({
      mode: "form",
      message: consequenceText(details, deps.testMode),
      requestedSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            title: "Go ahead?",
            description: details.action,
          },
        },
        required: ["confirm"],
      },
    });

    if (res.action === "accept" && res.content?.confirm === true) return { ok: true };
    return {
      ok: false,
      result: {
        content: [
          {
            type: "text",
            text:
              res.action === "accept"
                ? "Not confirmed — the human answered no. Nothing was changed."
                : `Not confirmed (${res.action}). Nothing was changed.`,
          },
        ],
      },
    };
  }

  // Two-step token fallback.
  const argsHash = hashArgs(args);
  const supplied = typeof args.confirmation_token === "string" ? args.confirmation_token : null;

  if (supplied) {
    sweep(Date.now());
    const entry = pending.get(supplied);
    pending.delete(supplied); // single use, whether or not it matched
    if (!entry) {
      return {
        ok: false,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "That confirmation token is unknown or has expired (tokens last 60 seconds and " +
                "may be used once). Call this tool again without a token to get a fresh preview.",
            },
          ],
        },
      };
    }
    if (entry.toolName !== toolName || entry.argsHash !== argsHash) {
      return {
        ok: false,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "That confirmation token was issued for a different call. A token confirms one " +
                "exact set of arguments — request a fresh preview for the call you actually want.",
            },
          ],
        },
      };
    }
    return { ok: true };
  }

  const token = randomUUID();
  pending.set(token, { toolName, argsHash, expiresAt: Date.now() + TOKEN_TTL_MS });
  return {
    ok: false,
    result: {
      content: [
        {
          type: "text",
          text:
            `CONFIRMATION REQUIRED — nothing has happened yet.\n\n${consequenceText(details, deps.testMode)}\n\n` +
            `Show this to the person you are acting for. If they agree, call ${toolName} again ` +
            `with exactly the same arguments plus confirmation_token: "${token}". ` +
            "The token is valid for 60 seconds and may be used once.",
        },
      ],
      structuredContent: { confirmation_required: true, confirmation_token: token },
    },
  };
}
