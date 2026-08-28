/**
 * Idempotency keys for the writes with a physical side effect.
 *
 * The API makes an open or a broadcast at-most-once per key for 24 hours when
 * given a token: a retry replays the original status and body instead of firing
 * again. A model that retries on a timeout is exactly the case this protects
 * against, so the server always sends one rather than leaving it to the caller.
 */
import { randomUUID } from "node:crypto";

export function idempotencyKey(): string {
  return `mcp-${randomUUID()}`;
}
