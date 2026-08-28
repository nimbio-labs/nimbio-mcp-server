import { describe, it, expect } from "vitest";
import {
  APIError,
  ConflictError,
  GateNotOpenedError,
  PermissionDeniedError,
  RateLimitError,
  UpstreamError,
} from "@nimbio/community-api";
import { normalizeError } from "../src/errors.js";
import type { Session } from "../src/session.js";

const session: Session = {
  scope: "community",
  testMode: true,
  capabilities: ["open", "gate_status"],
  communityId: "2590",
  keyName: "k",
  minuteLimit: null,
  monthLimit: null,
  monthCount: null,
  writesPermitted: true,
  writesWithheldReason: null,
};

describe("504 did_not_open", () => {
  const err = new GateNotOpenedError("gate did not confirm", {
    status: 504,
    code: "did_not_open",
    requestId: "req_1",
  });

  it("says the gate may have opened anyway", () => {
    const msg = normalizeError(err, session);
    expect(msg).toMatch(/may\s+have physically fired/);
  });

  it("warns that the idempotency token is NOT released", () => {
    expect(normalizeError(err, session)).toMatch(/NOT released/);
  });

  it("tells the model not to retry blindly, and where to look instead", () => {
    const msg = normalizeError(err, session);
    expect(msg).toMatch(/Do not retry blindly/);
    expect(msg).toMatch(/nimbio_gate_status/);
    expect(msg).toContain("req_1");
  });
});

describe("scan_required", () => {
  it("gets one explanation whether it arrives as 409 or 403", () => {
    const asConflict = new ConflictError("nfc required", { status: 409, code: "scan_required" });
    const asForbidden = new PermissionDeniedError("nfc required", {
      status: 403,
      code: "scan_required",
    });
    for (const err of [asConflict, asForbidden]) {
      const msg = normalizeError(err, session);
      expect(msg).toMatch(/NFC-scan-only/);
      expect(msg).toMatch(/nothing to retry/);
    }
    // And each still reports the status it actually arrived as.
    expect(normalizeError(asConflict, session)).toContain("409");
    expect(normalizeError(asForbidden, session)).toContain("403");
  });
});

describe("capability 403", () => {
  it("names the missing capability and says a retry will not help", () => {
    const err = new PermissionDeniedError("forbidden", { status: 403 });
    const msg = normalizeError(err, session, "webhooks");
    expect(msg).toMatch(/"webhooks" capability/);
    expect(msg).toMatch(/no retry will help/);
  });

  it("does not claim a capability is missing when the key has it", () => {
    const err = new PermissionDeniedError("forbidden", { status: 403 });
    expect(normalizeError(err, session, "open")).not.toMatch(/does not carry/);
  });
});

describe("the actionable 409s", () => {
  it.each([
    ["delivery_in_flight", /still retrying/],
    ["webhook_disabled", /Re-enable it/],
    ["requires_confirmation", /confirm: true/],
  ])("explains %s", (code, expected) => {
    const msg = normalizeError(new ConflictError("nope", { status: 409, code }), session);
    expect(msg).toMatch(expected);
  });
});

describe("other statuses", () => {
  it("reports the retry-after on a 429 and distinguishes the two limits", () => {
    const err = new RateLimitError("slow down", { status: 429, retryAfter: 30 });
    const msg = normalizeError(err, session);
    expect(msg).toContain("30s");
    expect(msg).toMatch(/monthly quota are separate/);
  });

  it("marks an upstream failure retry-safe, unlike a 504", () => {
    const msg = normalizeError(new UpstreamError("down", { status: 502 }), session);
    expect(msg).toMatch(/retry-safe/);
  });

  it("falls back to status, code and request id for anything else", () => {
    const err = new APIError("weird", { status: 418, code: "teapot", requestId: "req_9" });
    const msg = normalizeError(err, session);
    expect(msg).toContain("418");
    expect(msg).toContain("teapot");
    expect(msg).toContain("req_9");
  });

  it("handles a plain Error and a non-Error throw", () => {
    expect(normalizeError(new TypeError("boom"), session)).toBe("TypeError: boom");
    expect(normalizeError("just a string", session)).toMatch(/Unexpected error/);
  });
});
