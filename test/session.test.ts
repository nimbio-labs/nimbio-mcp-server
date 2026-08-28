import { describe, it, expect } from "vitest";
import { openSession } from "../src/session.js";
import type { Config } from "../src/config.js";

function client(mode: string, type = "community") {
  return {
    me: async () => ({
      accountId: "a",
      key: {
        apiKeyId: "k",
        prefix: null,
        name: "test key",
        mode,
        type,
        communityId: "2590",
        capabilities: ["open", "members"],
        lastUsedDatetime: null,
        minuteLimit: 60,
        minuteCount: 0,
        monthLimit: 1000,
        monthCount: 12,
        raw: {},
      },
      raw: {},
    }),
  } as never;
}

const cfg = (over: Partial<Config> = {}): Config => ({
  apiKey: "k",
  environment: "dev",
  mode: "write",
  allowLive: false,
  allTools: false,
  ...over,
});

describe("openSession", () => {
  it("permits writes for a test key with no extra flag", async () => {
    const s = await openSession(client("test"), cfg());
    expect(s.testMode).toBe(true);
    expect(s.writesPermitted).toBe(true);
    expect(s.writesWithheldReason).toBeNull();
  });

  it("withholds writes for a LIVE key until NIMBIO_MCP_ALLOW_LIVE is set", async () => {
    const s = await openSession(client("live"), cfg());
    expect(s.testMode).toBe(false);
    expect(s.writesPermitted).toBe(false);
    expect(s.writesWithheldReason).toMatch(/NIMBIO_MCP_ALLOW_LIVE/);
  });

  it("permits writes for a live key once the operator opts in", async () => {
    const s = await openSession(client("live"), cfg({ allowLive: true }));
    expect(s.writesPermitted).toBe(true);
  });

  it("withholds writes in read-only mode regardless of key type", async () => {
    for (const mode of ["test", "live"]) {
      const s = await openSession(client(mode), cfg({ mode: "read-only", allowLive: true }));
      expect(s.writesPermitted).toBe(false);
      expect(s.writesWithheldReason).toMatch(/read-only/);
    }
  });
});
