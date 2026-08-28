/**
 * Environment-derived configuration.
 *
 * Credentials come from the environment, never from the protocol: the MCP
 * authorization spec tells stdio servers not to implement the OAuth flow and to
 * read credentials from the environment instead. See `docs/mcp-server-plan.md`
 * in nimbioCore for the reasoning.
 */

/**
 * How much this process is allowed to do.
 *
 * - `read-only` — only tools annotated `readOnlyHint` are registered. The
 *   default, so a careless install reads and cannot write.
 * - `write` — write tools register, and the ones with irreversible effects
 *   require a human confirmation before they run.
 * - `unrestricted` — write tools register with no confirmation. For headless
 *   automation where no human is present to confirm.
 */
export type Mode = "read-only" | "write" | "unrestricted";

export const MODES: readonly Mode[] = Object.freeze(["read-only", "write", "unrestricted"]);

export interface Config {
  apiKey: string;
  environment: string;
  mode: Mode;
  /** Set when `NIMBIO_MCP_ALLOW_LIVE` is present: permits writes on a live key. */
  allowLive: boolean;
  /** Set when `NIMBIO_MCP_ALL_TOOLS` is present: skip capability filtering. */
  allTools: boolean;
}

export class ConfigError extends Error {}

/** True for any value a human would mean as "on". "0"/"false"/"no"/"" are off. */
function flag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.NIMBIO_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError(
      "NIMBIO_API_KEY is not set. Create an API key in the Nimbio community " +
        "portal and put it in the server's environment. A nimbio_test_* key " +
        "runs the full pipeline without opening any gate — start there.",
    );
  }

  const rawMode = (env.NIMBIO_MCP_MODE ?? "read-only").trim().toLowerCase();
  if (!MODES.includes(rawMode as Mode)) {
    throw new ConfigError(
      `NIMBIO_MCP_MODE must be one of ${MODES.join(", ")} (got ${JSON.stringify(rawMode)}).`,
    );
  }

  return {
    apiKey,
    environment: (env.NIMBIO_ENV ?? "prod").trim().toLowerCase(),
    mode: rawMode as Mode,
    allowLive: flag(env.NIMBIO_MCP_ALLOW_LIVE),
    allTools: flag(env.NIMBIO_MCP_ALL_TOOLS),
  };
}
