/**
 * What this process learned about its own API key at startup.
 *
 * Exactly one call — `me()` — establishes it. That endpoint is
 * monthly-quota-exempt, so orienting costs the operator nothing.
 */
import type { NimbioClient } from "@nimbio/community-api";
import type { Config } from "./config.js";

export interface Session {
  /** `"account"` or `"community"`. */
  scope: string;
  /** True for a `nimbio_test_*` key: writes are simulated, no gate can open. */
  testMode: boolean;
  capabilities: string[];
  communityId: string | null;
  keyName: string | null;
  minuteLimit: number | null;
  monthLimit: number | null;
  monthCount: number | null;
  /**
   * True when write tools may register at all: a test key always may; a live
   * key needs `NIMBIO_MCP_ALLOW_LIVE`, so the failure mode of a careless
   * install is a server that reads rather than one that opens gates.
   */
  writesPermitted: boolean;
  /** Human-readable reason writes are withheld, or null when they are not. */
  writesWithheldReason: string | null;
}

export async function openSession(client: NimbioClient, config: Config): Promise<Session> {
  const me = await client.me();
  const key = me.key;
  const testMode = key.mode === "test";

  let writesPermitted = true;
  let writesWithheldReason: string | null = null;

  if (config.mode === "read-only") {
    writesPermitted = false;
    writesWithheldReason =
      "NIMBIO_MCP_MODE is read-only (the default). Set NIMBIO_MCP_MODE=write to register write tools.";
  } else if (!testMode && !config.allowLive) {
    writesPermitted = false;
    writesWithheldReason =
      `This is a ${key.mode ?? "non-test"}-mode key, so a write would take real effect — ` +
      "opening real gates, messaging real residents. Write tools are withheld until " +
      "NIMBIO_MCP_ALLOW_LIVE is set in the server's environment. A nimbio_test_* key " +
      "needs no such flag.";
  }

  return {
    scope: key.type ?? "unknown",
    testMode,
    capabilities: key.capabilities,
    communityId: key.communityId,
    keyName: key.name,
    minuteLimit: key.minuteLimit,
    monthLimit: key.monthLimit,
    monthCount: key.monthCount,
    writesPermitted,
    writesWithheldReason,
  };
}
