/**
 * Result shaping.
 *
 * Every tool returns two content blocks — a human-readable summary and the
 * serialized JSON (the spec asks a tool returning `structuredContent` to also
 * return the JSON as text for clients that do not read structured results) —
 * plus `structuredContent` itself.
 *
 * The summary always opens with a mode marker. A reader scrolling a transcript
 * should never have to work out whether what they are looking at touched a real
 * gate.
 */
import type { Session } from "./session.js";

export interface ToolResult {
  /** The SDK's `CallToolResult` carries an open index signature; match it. */
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function marker(session: Session): string {
  return session.testMode
    ? "[TEST MODE — nimbio_test_* key: writes are simulated and no gate can open]"
    : "[LIVE — nimbio_live_* key: writes take real effect]";
}

/** A successful tool result: marker, summary, then the JSON payload. */
export function ok(
  session: Session,
  summary: string,
  structured: Record<string, unknown>,
): ToolResult {
  return {
    content: [
      { type: "text", text: `${marker(session)}\n\n${summary}` },
      { type: "text", text: JSON.stringify(structured, null, 2) },
    ],
    structuredContent: structured,
  };
}

/**
 * A tool execution error — reported in the result with `isError: true` rather
 * than as a JSON-RPC error, so the model can read it and self-correct.
 */
export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
