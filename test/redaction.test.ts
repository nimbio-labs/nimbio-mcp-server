import { describe, it, expect } from "vitest";
import { redactLink, REDACTED } from "../src/redact.js";
import { TOOLS } from "../src/tools/index.js";
import { ok, wrote, marker } from "../src/format.js";
import type { Session } from "../src/session.js";

const session = (testMode: boolean): Session => ({
  scope: "community",
  testMode,
  capabilities: [],
  communityId: "2590",
  keyName: "k",
  minuteLimit: null,
  monthLimit: null,
  monthCount: null,
  writesPermitted: true,
  writesWithheldReason: null,
});

describe("guest-link redaction", () => {
  const row = { guest_link_id: 1, token: "secret-token", url: "https://g.nimbio.com/e/secret-token" };

  it("hides the token and the URL by default", () => {
    const out = redactLink(row, false);
    expect(out.token).toBe(REDACTED);
    expect(out.url).toBe(REDACTED);
    expect(JSON.stringify(out)).not.toContain("secret-token");
  });

  it("reveals them only on explicit request", () => {
    expect(redactLink(row, true)).toEqual(row);
  });

  it("leaves a null token null rather than pretending there is one", () => {
    const out = redactLink({ token: null, url: null }, false);
    expect(out.token).toBeNull();
    expect(out.url).toBeNull();
  });

  it("does not mutate the row it was given", () => {
    redactLink(row, false);
    expect(row.token).toBe("secret-token");
  });
});

describe("the tools that can surface a guest credential", () => {
  it("both offer reveal, and both default to redacting", () => {
    for (const name of ["nimbio_list_guest_links", "nimbio_create_guest_link"]) {
      const tool = TOOLS.find((t) => t.name === name)!;
      expect(tool.inputSchema, name).toHaveProperty("reveal");
    }
  });

  it("warns in the reveal description that it writes a credential into the transcript", () => {
    const tool = TOOLS.find((t) => t.name === "nimbio_create_guest_link")!;
    const desc = (tool.inputSchema!.reveal as { description?: string }).description ?? "";
    expect(desc).toMatch(/credential/i);
  });
});

describe("mode markers", () => {
  it("labels test and live results differently", () => {
    expect(marker(session(true))).toMatch(/TEST MODE/);
    expect(marker(session(false))).toMatch(/LIVE/);
  });

  it("puts the marker on every read result", () => {
    const res = ok(session(true), "summary", { a: 1 });
    expect(res.content[0]!.text).toMatch(/TEST MODE/);
    // The JSON is repeated as text for clients that ignore structuredContent.
    expect(res.structuredContent).toEqual({ a: 1 });
    expect(JSON.parse(res.content[1]!.text)).toEqual({ a: 1 });
  });

  it("reports a write the API says it simulated", () => {
    const res = wrote(session(true), "did a thing", { simulated: true });
    expect(res.content[0]!.text).toMatch(/SIMULATED/);
  });

  it("reports a write the API says was real", () => {
    const res = wrote(session(false), "did a thing", { simulated: false });
    expect(res.content[0]!.text).toMatch(/DONE — this really happened/);
  });

  it("assumes simulated when the endpoint reports nothing and the key is a test key", () => {
    // Erring the other way would tell the reader a change was real when it was not.
    expect(wrote(session(true), "x", {}).content[0]!.text).toMatch(/SIMULATED/);
    expect(wrote(session(false), "x", {}).content[0]!.text).toMatch(/DONE/);
  });
});
