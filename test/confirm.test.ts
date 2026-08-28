import { describe, it, expect, beforeEach } from "vitest";
import { confirm, hashArgs, _clearPending, _pendingSize } from "../src/confirm.js";
import type { ConfirmDeps } from "../src/confirm.js";

const details = { action: "Open the North Gate", facts: ["Community 2590"] };

function deps(over: Partial<{ elicitation: boolean; reply: unknown; unrestricted: boolean }> = {}) {
  const calls: unknown[] = [];
  const server = {
    getClientCapabilities: () => (over.elicitation ? { elicitation: {} } : {}),
    elicitInput: async (params: unknown) => {
      calls.push(params);
      return over.reply ?? { action: "accept", content: { confirm: true } };
    },
  };
  return {
    deps: {
      server: server as never,
      unrestricted: over.unrestricted ?? false,
      testMode: true,
    } satisfies ConfirmDeps,
    calls,
  };
}

beforeEach(() => _clearPending());

describe("confirm — unrestricted mode", () => {
  it("does not ask", async () => {
    const { deps: d, calls } = deps({ elicitation: true, unrestricted: true });
    expect(await confirm(d, "nimbio_open_gate", {}, details)).toEqual({ ok: true });
    expect(calls).toHaveLength(0);
  });
});

describe("confirm — elicitation path", () => {
  it("proceeds when the human accepts", async () => {
    const { deps: d, calls } = deps({ elicitation: true });
    expect(await confirm(d, "nimbio_open_gate", {}, details)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    // The question put to the human must name the consequence and the mode.
    const params = calls[0] as { message: string };
    expect(params.message).toContain("Open the North Gate");
    expect(params.message).toContain("TEST MODE");
  });

  it("refuses when the human declines the boolean", async () => {
    const { deps: d } = deps({ elicitation: true, reply: { action: "accept", content: { confirm: false } } });
    const out = await confirm(d, "nimbio_open_gate", {}, details);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.result.content[0]!.text).toMatch(/answered no/);
  });

  it("refuses when the human cancels the prompt entirely", async () => {
    const { deps: d } = deps({ elicitation: true, reply: { action: "cancel" } });
    const out = await confirm(d, "nimbio_open_gate", {}, details);
    expect(out.ok).toBe(false);
  });

  it("issues no token when it can elicit", async () => {
    const { deps: d } = deps({ elicitation: true });
    await confirm(d, "nimbio_open_gate", {}, details);
    expect(_pendingSize()).toBe(0);
  });
});

describe("confirm — two-step token fallback", () => {
  it("previews and issues a single-use token when the client cannot elicit", async () => {
    const { deps: d } = deps();
    const out = await confirm(d, "nimbio_open_gate", { latch_id: "L1" }, details);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.result.isError).toBeUndefined(); // a preview is not a failure
    expect(out.result.content[0]!.text).toContain("nothing has happened yet");
    const token = (out.result.structuredContent as { confirmation_token: string }).confirmation_token;
    expect(token).toBeTruthy();

    expect(
      await confirm(d, "nimbio_open_gate", { latch_id: "L1", confirmation_token: token }, details),
    ).toEqual({ ok: true });
  });

  it("refuses a token issued for different arguments", async () => {
    const { deps: d } = deps();
    const first = await confirm(d, "nimbio_open_gate", { latch_id: "L1" }, details);
    const token = !first.ok
      ? (first.result.structuredContent as { confirmation_token: string }).confirmation_token
      : "";
    const out = await confirm(
      d,
      "nimbio_open_gate",
      { latch_id: "SOMEWHERE_ELSE", confirmation_token: token },
      details,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.result.isError).toBe(true);
      expect(out.result.content[0]!.text).toMatch(/different call/);
    }
  });

  it("refuses a token issued for a different tool", async () => {
    const { deps: d } = deps();
    const first = await confirm(d, "nimbio_open_gate", { x: 1 }, details);
    const token = !first.ok
      ? (first.result.structuredContent as { confirmation_token: string }).confirmation_token
      : "";
    const out = await confirm(d, "nimbio_send_message", { x: 1, confirmation_token: token }, details);
    expect(out.ok).toBe(false);
  });

  it("spends the token — a replay is refused", async () => {
    const { deps: d } = deps();
    const first = await confirm(d, "nimbio_open_gate", { latch_id: "L1" }, details);
    const token = !first.ok
      ? (first.result.structuredContent as { confirmation_token: string }).confirmation_token
      : "";
    expect(
      await confirm(d, "nimbio_open_gate", { latch_id: "L1", confirmation_token: token }, details),
    ).toEqual({ ok: true });
    const again = await confirm(
      d,
      "nimbio_open_gate",
      { latch_id: "L1", confirmation_token: token },
      details,
    );
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.result.content[0]!.text).toMatch(/unknown or has expired/);
  });

  it("refuses a token it never issued", async () => {
    const { deps: d } = deps();
    const out = await confirm(
      d,
      "nimbio_open_gate",
      { confirmation_token: "not-a-real-token" },
      details,
    );
    expect(out.ok).toBe(false);
  });
});

describe("hashArgs", () => {
  it("ignores the token itself, so the hash is stable across the two calls", () => {
    expect(hashArgs({ a: 1, confirmation_token: "x" })).toBe(hashArgs({ a: 1 }));
  });

  it("distinguishes different arguments", () => {
    expect(hashArgs({ latch_id: "A" })).not.toBe(hashArgs({ latch_id: "B" }));
  });
});
