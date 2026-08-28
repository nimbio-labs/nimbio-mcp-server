/** The shape every tool definition shares. */
import type { NimbioClient } from "@nimbio/community-api";
import type { ZodRawShape } from "zod";
import type { Config } from "../config.js";
import type { Session } from "../session.js";
import type { ToolResult } from "../format.js";
import type { ConfirmDetails, ConfirmOutcome } from "../confirm.js";

export interface ToolContext {
  client: NimbioClient;
  session: Session;
  config: Config;
  /**
   * Ask a human before doing something irreversible. Returns `{ok: true}` to
   * proceed, or a result the tool must return unchanged.
   */
  confirm: (
    toolName: string,
    args: Record<string, unknown>,
    details: ConfirmDetails,
  ) => Promise<ConfirmOutcome>;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** Zod raw shape; omit for a tool taking no arguments. */
  inputSchema?: ZodRawShape;
  outputSchema?: ZodRawShape;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /**
   * Capability this tool needs on the key (from `me().key.capabilities`).
   * Omit for tools every key can call. A tool whose capability is absent is
   * not registered, so the model never picks a tool destined to 403.
   */
  capability?: string;
  /** Which key scope this tool applies to. Defaults to `"community"`. */
  scope?: "community" | "account" | "any";
  /** The REST operations this tool covers, for `surface.json` and the parity gate. */
  endpoints: string[];
  /**
   * Present on tools whose effect cannot be undone by a follow-up call. Builds
   * the consequence text a human is asked to approve.
   */
  confirm?: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ConfirmDetails>;
  handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;
}

/** True when this tool changes something. Drives mode gating. */
export function isWrite(tool: ToolDef): boolean {
  return !tool.annotations.readOnlyHint;
}
