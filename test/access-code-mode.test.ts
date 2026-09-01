import { describe, it, expect } from "vitest";
import { TOOLS } from "../src/tools/index.js";
import type { ToolContext } from "../src/tools/types.js";
import type { Session } from "../src/session.js";
import type { Config } from "../src/config.js";

/**
 * The mode switch is the one write that deletes every access code in a
 * community, so its confirmation text must carry the real blast radius and its
 * handler must tell the truth about what happened (changed / unchanged /
 * simulated). Both are driven here against a scripted client.
 */
const session: Session = {
  scope: "community",
  environment: "dev",
  baseUrl: "https://api.nimbio.dev",
  testMode: false,
  capabilities: ["access_code_mode", "access_codes"],
  communityId: "2590",
  keyName: "k",
  minuteLimit: 60,
  monthLimit: 1000,
  monthCount: 1,
  writesPermitted: true,
  writesWithheldReason: null,
};
const config: Config = { apiKey: "k", environment: "dev", mode: "write", allowLive: true, allTools: false };

const preview = {
  mode: null,
  newMode: "single_entry",
  codesToDelete: 14,
  membersAffected: 9,
  membersToAssignPreamble: 112,
  raw: {},
};

function ctxWith(community: Record<string, unknown>): ToolContext {
  return {
    client: { community } as never,
    session,
    config,
    confirm: async () => ({ ok: true }),
  };
}

const status = (mode: string) => async () => ({ mode, flipPreview: preview, result: "ok", raw: {} });

const read = TOOLS.find((t) => t.name === "nimbio_access_code_mode")!;
const write = TOOLS.find((t) => t.name === "nimbio_set_access_code_mode")!;

describe("nimbio_access_code_mode", () => {
  it("reports the mode and the flip preview in snake_case", async () => {
    const res = await read.handler(ctxWith({ accessCodeMode: status("per_member") }), {});
    expect(res.structuredContent).toEqual({
      mode: "per_member",
      flip_preview: {
        new_mode: "single_entry",
        codes_to_delete: 14,
        members_affected: 9,
        members_to_assign_preamble: 112,
      },
    });
    expect(res.content[0]?.text).toMatch(/delete 14 code\(s\) held by 9 member\(s\)/);
  });
});

describe("nimbio_set_access_code_mode confirmation", () => {
  it("states how many codes and members a real switch destroys", async () => {
    const details = await write.confirm!(
      { mode: "single_entry" },
      ctxWith({ accessCodeMode: status("per_member") }),
    );
    expect(details.action).toBe("Switch access codes to single_entry");
    const facts = details.facts.join("\n");
    expect(facts).toMatch(/14 access code\(s\) held by 9 member\(s\) will be DELETED/);
    expect(facts).toMatch(/112 member\(s\) will be given a 3-letter preamble/);
  });

  it("says so when the community is already in that mode", async () => {
    const details = await write.confirm!(
      { mode: "single_entry" },
      ctxWith({ accessCodeMode: status("single_entry") }),
    );
    expect(details.facts).toEqual([
      "The community is already in single_entry mode — this call will change nothing.",
    ]);
  });

  it("falls back to the generic warning when the preview cannot be fetched", async () => {
    const details = await write.confirm!(
      { mode: "per_member" },
      ctxWith({
        accessCodeMode: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(details.facts[0]).toMatch(/DELETED and cannot be restored/);
  });
});

describe("nimbio_set_access_code_mode handler", () => {
  const change = (over: Record<string, unknown>) => ({
    mode: "single_entry",
    changed: false,
    deletedCodes: null,
    notifiedMembers: null,
    wouldChange: null,
    result: "ok",
    requestId: "r",
    simulated: false,
    raw: {},
    ...over,
  });

  it("always sends confirm: true — the human already agreed through the MCP confirmation", async () => {
    const seen: unknown[] = [];
    const ctx = ctxWith({
      setAccessCodeMode: async (mode: string, opts: unknown) => {
        seen.push([mode, opts]);
        return change({ mode, changed: true, deletedCodes: 14, notifiedMembers: 9 });
      },
    });
    const res = await write.handler(ctx, { mode: "single_entry" });
    expect(seen).toEqual([["single_entry", { confirm: true }]]);
    expect(res.content[0]?.text).toMatch(/DONE — this really happened/);
    expect(res.content[0]?.text).toMatch(
      /switched to single_entry\. 14 code\(s\) deleted, 9 member\(s\) notified/,
    );
    expect(res.structuredContent).toMatchObject({
      mode: "single_entry",
      changed: true,
      deleted_codes: 14,
      notified_members: 9,
      simulated: false,
    });
  });

  it("reports an unchanged mode plainly", async () => {
    const ctx = ctxWith({ setAccessCodeMode: async (mode: string) => change({ mode }) });
    const res = await write.handler(ctx, { mode: "per_member" });
    expect(res.content[0]?.text).toMatch(/Already in per_member mode — nothing changed/);
  });

  it("labels a test-key dry run as simulated with the would-change counts", async () => {
    const ctx = ctxWith({
      setAccessCodeMode: async () => change({ wouldChange: preview, result: "simulated", simulated: true }),
    });
    const res = await write.handler(ctx, { mode: "single_entry" });
    expect(res.content[0]?.text).toMatch(/SIMULATED/);
    expect(res.content[0]?.text).toMatch(
      /Would switch to single_entry: 14 code\(s\) deleted, 9 member\(s\) notified/,
    );
    expect(res.structuredContent).toMatchObject({ simulated: true, would_change: { codes_to_delete: 14 } });
  });
});
