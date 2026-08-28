/**
 * Server construction: decide which tools this key and this mode may see, then
 * register them.
 *
 * Filtering happens once, at startup. On stdio the key is fixed for the life of
 * the process, so the resulting tool list is stable — which is what the spec
 * requires of `tools/list`. Nothing here varies per call.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NimbioClient } from "@nimbio/community-api";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Session } from "./session.js";
import { fail } from "./format.js";
import { confirm as runConfirm } from "./confirm.js";
import { normalizeError } from "./errors.js";
import { TOOLS } from "./tools/index.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";
import { isWrite, type ToolDef, type ToolContext } from "./tools/types.js";
import { VERSION } from "./version.js";

/** Why a tool was left out, for the startup banner. */
export interface Filtered {
  registered: ToolDef[];
  withheldForMode: ToolDef[];
  withheldForCapability: ToolDef[];
  withheldForScope: ToolDef[];
}

export function selectTools(session: Session, config: Config): Filtered {
  const registered: ToolDef[] = [];
  const withheldForMode: ToolDef[] = [];
  const withheldForCapability: ToolDef[] = [];
  const withheldForScope: ToolDef[] = [];

  for (const tool of TOOLS) {
    const scope = tool.scope ?? "community";
    if (scope !== "any" && session.scope !== scope) {
      withheldForScope.push(tool);
      continue;
    }
    if (isWrite(tool) && !session.writesPermitted) {
      withheldForMode.push(tool);
      continue;
    }
    if (tool.capability && !config.allTools && !session.capabilities.includes(tool.capability)) {
      withheldForCapability.push(tool);
      continue;
    }
    registered.push(tool);
  }

  return { registered, withheldForMode, withheldForCapability, withheldForScope };
}

/** Instructions the host shows the model alongside the tool list. */
export function instructions(session: Session, filtered: Filtered): string {
  const lines = [
    "Nimbio community access control — gates, members, guest access and access logs.",
    "",
    session.testMode
      ? "This key is in TEST MODE. Every write runs the full pipeline — auth, rate limit, " +
        "scope, validation — and is then simulated: no gate opens, no message is sent, " +
        "nothing is persisted. It is safe to explore."
      : "This key is LIVE. Writes take real effect: gates physically open and residents " +
        "receive real messages. Confirm before acting.",
    "",
    `Host: ${session.baseUrl} (${session.environment}).`,
    `Scope: ${session.scope}${session.communityId ? `, community ${session.communityId}` : ""}.`,
    `${filtered.registered.length} tools available.`,
  ];
  if (!session.writesPermitted && session.writesWithheldReason) {
    lines.push("", `Write tools are not available: ${session.writesWithheldReason}`);
  }
  if (filtered.withheldForCapability.length) {
    lines.push(
      "",
      "Withheld — this key lacks the capability: " +
        filtered.withheldForCapability.map((t) => `${t.name} (needs ${t.capability})`).join(", "),
    );
  }
  return lines.join("\n");
}

export function createServer(client: NimbioClient, session: Session, config: Config): McpServer {
  const filtered = selectTools(session, config);
  const server = new McpServer(
    { name: "nimbio", version: VERSION },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
        prompts: { listChanged: false },
      },
      instructions: instructions(session, filtered),
    },
  );

  registerResources(server, client, session);
  registerPrompts(server, session);

  const ctx: ToolContext = {
    client,
    session,
    config,
    confirm: (toolName, args, details) =>
      runConfirm(
        { server: server.server, unrestricted: config.mode === "unrestricted", testMode: session.testMode },
        toolName,
        args,
        details,
      ),
  };

  for (const tool of filtered.registered) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: withConfirmationArg(tool) as z.ZodRawShape,
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => {
        const supplied = args ?? {};
        try {
          if (tool.confirm) {
            const outcome = await ctx.confirm(tool.name, supplied, await tool.confirm(supplied, ctx));
            if (!outcome.ok) return outcome.result;
          }
          return await tool.handler(ctx, supplied);
        } catch (err) {
          return fail(normalizeError(err, session, tool.capability));
        }
      },
    );
  }

  return server;
}

/**
 * Confirm-gated tools accept an extra argument carrying the token from their
 * own preview. It is added here rather than in each tool so no tool can forget
 * it, and so it never appears on a tool that does not need confirming.
 */
export function withConfirmationArg(tool: ToolDef): z.ZodRawShape {
  const base = (tool.inputSchema ?? {}) as z.ZodRawShape;
  if (!tool.confirm) return base;
  return {
    ...base,
    confirmation_token: z
      .string()
      .optional()
      .describe(
        "The token from this tool's own confirmation preview. Omit on the first call — you " +
          "will be shown what the call would do and given a token to repeat it with.",
      ),
  };
}
