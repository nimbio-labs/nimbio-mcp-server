import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError, MODES } from "../src/config.js";

describe("loadConfig", () => {
  it("refuses to start without an API key, and says how to get one", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
    } catch (err) {
      expect((err as Error).message).toMatch(/nimbio_test_/);
    }
  });

  it("defaults to the safest mode", () => {
    expect(loadConfig({ NIMBIO_API_KEY: "k" }).mode).toBe("read-only");
  });

  it("accepts every documented mode and rejects anything else", () => {
    for (const mode of MODES) {
      expect(loadConfig({ NIMBIO_API_KEY: "k", NIMBIO_MCP_MODE: mode }).mode).toBe(mode);
    }
    expect(() => loadConfig({ NIMBIO_API_KEY: "k", NIMBIO_MCP_MODE: "yolo" })).toThrow(ConfigError);
  });

  it("reads flags the way a human means them", () => {
    const on = (v: string) => loadConfig({ NIMBIO_API_KEY: "k", NIMBIO_MCP_ALLOW_LIVE: v }).allowLive;
    expect(on("1")).toBe(true);
    expect(on("true")).toBe(true);
    expect(on("yes")).toBe(true);
    // A flag set to something falsey must not read as "on" — this is the guard
    // standing between a live key and a registered write tool.
    expect(on("0")).toBe(false);
    expect(on("false")).toBe(false);
    expect(on("")).toBe(false);
    expect(loadConfig({ NIMBIO_API_KEY: "k" }).allowLive).toBe(false);
  });
});
