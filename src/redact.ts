/**
 * Guest-link credentials are secret material.
 *
 * `token` and the ready-to-send `url` come back from creating a guest link *and*
 * from listing them. That is deliberate on the API's side — a lost URL is
 * recoverable — but it means a listing is a set of working gate credentials:
 * anyone holding one opens the gate with no account, no key and no login.
 *
 * A transcript is a log. So these are redacted unless the caller explicitly asks
 * for them, and the tool that accepts `reveal` says plainly what it does.
 */
export const REDACTED = "«redacted — call again with reveal: true to see it»";

export function redactLink<T extends { token?: unknown; url?: unknown }>(
  row: T,
  reveal: boolean,
): T {
  if (reveal) return row;
  return { ...row, token: row.token == null ? row.token : REDACTED, url: row.url == null ? row.url : REDACTED };
}

/** Appended to any result that redacted something, so the model knows why. */
export const REDACTION_NOTE =
  "Guest-link tokens and URLs are redacted: each one opens the gate on its own, " +
  "with no account or login. Pass reveal: true only if you intend to write a " +
  "working gate credential into this conversation.";
