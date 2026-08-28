/**
 * Turning API failures into something a model can act on.
 *
 * Three of these genuinely mislead if passed through raw, and each has bitten
 * a real integrator:
 *
 *  - a 504 `did_not_open` is a *documented normal outcome*, not a crash, and
 *    the gate may have physically opened anyway;
 *  - `scan_required` arrives as 409 on the account open and 403 on the
 *    community open, for the same underlying condition;
 *  - a bare 403 on a capability-gated family looks like a bug when it is
 *    actually "this key was never granted that".
 */
import {
  APIError,
  ConflictError,
  GateNotOpenedError,
  PermissionDeniedError,
  RateLimitError,
  AuthenticationError,
  NotFoundError,
  UpstreamError,
} from "@nimbio/community-api";
import type { Session } from "./session.js";

/** Capability each endpoint family needs, for a friendlier 403. */
function capabilityHint(session: Session, capability?: string): string {
  if (!capability) return "";
  if (session.capabilities.includes(capability)) return "";
  return (
    ` This key does not carry the "${capability}" capability — it was never granted, so no ` +
    `retry will help. The key's capabilities are: ${session.capabilities.join(", ") || "(none)"}.`
  );
}

export function normalizeError(err: unknown, session: Session, capability?: string): string {
  if (err instanceof GateNotOpenedError) {
    return (
      "The gate did not confirm within the backend's window (504 did_not_open).\n\n" +
      "IMPORTANT: this does NOT mean the gate stayed shut. The open was dispatched and may " +
      "have physically fired — a slow or flaky gate reports exactly this. The idempotency " +
      "token is deliberately NOT released for this outcome, so retrying the identical call " +
      "replays this result rather than opening again.\n\n" +
      "Do not retry blindly. Check nimbio_gate_status or nimbio_gate_status_log to see " +
      "whether the gate actually moved, and tell the user what you found." +
      (err.requestId ? `\n\nrequest_id: ${err.requestId}` : "")
    );
  }

  if (err instanceof APIError && err.code === "scan_required") {
    return (
      "This gate is NFC-scan-only: it can only be opened by physically scanning a tag at the " +
      "gate, never remotely. No API call will open it, so there is nothing to retry. " +
      `(Reported as HTTP ${err.status}; this condition arrives as 409 on the account open and ` +
      "403 on the community open, for the same reason.)"
    );
  }

  if (err instanceof ConflictError) {
    const by = {
      delivery_in_flight:
        "Nimbio is still retrying that delivery itself. Wait for it to settle rather than " +
        "forcing a replay — replaying now risks delivering the event twice.",
      webhook_disabled:
        "That webhook is disabled. Re-enable it first (nimbio_manage_webhook with active: true), " +
        "then retry.",
      requires_confirmation:
        "The API is warning you about this call rather than refusing it. Read the message, and " +
        "if the consequence is what you intend, repeat the call with confirm: true.",
    }[err.code ?? ""];
    return `Conflict (409${err.code ? ` ${err.code}` : ""}): ${err.message}${by ? `\n\n${by}` : ""}`;
  }

  if (err instanceof RateLimitError) {
    return (
      `Rate limited (429${err.code ? ` ${err.code}` : ""}): ${err.message}` +
      (err.retryAfter !== null ? `\nRetry after ${err.retryAfter}s.` : "") +
      "\nNote the per-minute limit and the monthly quota are separate; this says which one " +
      "you hit."
    );
  }

  if (err instanceof PermissionDeniedError) {
    return `Permission denied (403${err.code ? ` ${err.code}` : ""}): ${err.message}${capabilityHint(session, capability)}`;
  }

  if (err instanceof AuthenticationError) {
    return `Authentication failed (401): ${err.message}. The API key is missing, malformed or revoked.`;
  }

  if (err instanceof NotFoundError) {
    return `Not found (404${err.code ? ` ${err.code}` : ""}): ${err.message}. Check the id — ids from one family are not valid in another.`;
  }

  if (err instanceof UpstreamError) {
    return (
      `The Nimbio backend was unavailable (${err.status}): ${err.message}. This is retry-safe — ` +
      "an idempotency token is released for this outcome, unlike a 504."
    );
  }

  if (err instanceof APIError) {
    return (
      `API error ${err.status}${err.code ? ` ${err.code}` : ""}: ${err.message}` +
      (err.requestId ? ` (request_id=${err.requestId})` : "")
    );
  }

  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return `Unexpected error: ${String(err)}`;
}
