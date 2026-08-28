import { describe, it, expect } from "vitest";
import { registerResources, SCHEDULE_RULES } from "../src/resources.js";
import { registerPrompts } from "../src/prompts.js";
import { withConfirmationArg } from "../src/server.js";
import { TOOLS } from "../src/tools/index.js";
import type { Session } from "../src/session.js";

type Registered = { name: string; uri: string; meta: Record<string, unknown>; read: (u: URL) => Promise<{ contents: { text?: string }[] }> };
type Prompted = { name: string; config: Record<string, unknown>; cb: (args: never) => { messages: { content: { text: string } }[] } };

function stubServer() {
  const resources: Registered[] = [];
  const prompts: Prompted[] = [];
  return {
    resources,
    prompts,
    server: {
      registerResource: (name: string, uri: string, meta: never, read: never) =>
        resources.push({ name, uri, meta, read } as Registered),
      registerPrompt: (name: string, config: never, cb: never) =>
        prompts.push({ name, config, cb } as unknown as Prompted),
    } as never,
  };
}

const client = {
  community: {
    gateStatus: async () => ({ latches: [{ latchId: "L1", latchName: "North", status: "closed", offline: false }] }),
    webhookEventTypes: async () => ["gate.opened"],
  },
} as never;

const session = (scope: string): Session => ({
  scope,
  testMode: true,
  capabilities: ["open"],
  communityId: "2590",
  keyName: "k",
  minuteLimit: null,
  monthLimit: null,
  monthCount: null,
  writesPermitted: true,
  writesWithheldReason: null,
});

describe("resources", () => {
  it("registers the community set for a community key", async () => {
    const { resources, server } = stubServer();
    registerResources(server, client, session("community"));
    expect(resources.map((r) => r.uri)).toEqual([
      "nimbio://capabilities",
      "nimbio://schedule-rules",
      "nimbio://gates",
      "nimbio://webhook-event-types",
    ]);
  });

  it("withholds community resources from an account key", () => {
    const { resources, server } = stubServer();
    registerResources(server, client, session("account"));
    expect(resources.map((r) => r.uri)).toEqual(["nimbio://capabilities", "nimbio://schedule-rules"]);
  });

  it("every resource reads without throwing and returns its uri", async () => {
    const { resources, server } = stubServer();
    registerResources(server, client, session("community"));
    for (const r of resources) {
      const out = await r.read(new URL(r.uri));
      expect(out.contents.length).toBeGreaterThan(0);
      expect(out.contents[0]!.text!.length).toBeGreaterThan(0);
    }
  });

  it("documents the traps the JSON types cannot carry", () => {
    // These four are the ones that fail silently when got wrong.
    expect(SCHEDULE_RULES).toMatch(/H = Thursday/);
    expect(SCHEDULE_RULES).toMatch(/latch's own local timezone/);
    expect(SCHEDULE_RULES).toMatch(/may not wrap past midnight/);
    expect(SCHEDULE_RULES).toMatch(/Quiet hours are the exception/);
  });
});

describe("prompts", () => {
  it("registers the four community prompts, and none for an account key", () => {
    const community = stubServer();
    registerPrompts(community.server, session("community"));
    expect(community.prompts.map((p) => p.name)).toEqual([
      "morning_gate_check",
      "onboard_resident",
      "investigate_after_hours_open",
      "issue_guest_access",
    ]);

    const account = stubServer();
    registerPrompts(account.server, session("account"));
    expect(account.prompts).toHaveLength(0);
  });

  it("every prompt renders a user message", () => {
    const { prompts, server } = stubServer();
    registerPrompts(server, session("community"));
    for (const p of prompts) {
      const out = p.cb({ name: "Ann", when: "last night", who: "a plumber" } as never);
      expect(out.messages[0]!.content.text.length).toBeGreaterThan(40);
    }
  });
});

describe("withConfirmationArg", () => {
  it("adds the token argument only to confirm-gated tools", () => {
    for (const tool of TOOLS) {
      const shape = withConfirmationArg(tool);
      expect("confirmation_token" in shape, tool.name).toBe(Boolean(tool.confirm));
    }
  });

  it("preserves the tool's own arguments", () => {
    const openGate = TOOLS.find((t) => t.name === "nimbio_open_gate")!;
    const shape = withConfirmationArg(openGate);
    expect(shape).toHaveProperty("latch_id");
    expect(shape).toHaveProperty("note");
  });
});

describe("createServer", () => {
  it("registers exactly the selected tools on a real McpServer", async () => {
    const { createServer, selectTools } = await import("../src/server.js");
    const config = {
      apiKey: "k",
      environment: "dev",
      mode: "write" as const,
      allowLive: false,
      allTools: true,
    };
    const s = session("community");
    const server = createServer(client, s, config);
    expect(server).toBeTruthy();

    // The server holds what selectTools chose — no more, no less.
    const chosen = selectTools(s, config).registered.length;
    const listed = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
    );
    expect(listed).toHaveLength(chosen);
    expect(listed).toContain("nimbio_whoami");
  });

  it("surfaces a handler failure as a tool error rather than throwing", async () => {
    const { createServer } = await import("../src/server.js");
    const exploding = {
      community: new Proxy({}, { get: () => async () => { throw new Error("upstream is down"); } }),
      account: {},
    } as never;
    const server = createServer(exploding, session("community"), {
      apiKey: "k",
      environment: "dev",
      mode: "read-only",
      allowLive: false,
      allTools: true,
    });
    const registered = (server as unknown as {
      _registeredTools: Record<string, { handler: (a: unknown, e: unknown) => Promise<{ isError?: boolean; content: { text: string }[] }> }>;
    })._registeredTools;
    const res = await registered.nimbio_gate_status!.handler({}, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/upstream is down/);
  });
});
