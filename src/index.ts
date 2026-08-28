/**
 * Entry point. Resolve config from the environment, open one session against
 * the API, then serve MCP over stdio.
 *
 * Anything written to stdout is protocol traffic, so every diagnostic goes to
 * stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { NimbioClient } from "@nimbio/community-api";
import { loadConfig, ConfigError } from "./config.js";
import { openSession } from "./session.js";
import { createServer, selectTools } from "./server.js";
import { VERSION } from "./version.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const client = new NimbioClient(config.apiKey, { environment: config.environment as never });
  const session = await openSession(client, config);
  const filtered = selectTools(session, config);

  console.error(
    `nimbio-mcp ${VERSION} — ${session.testMode ? "TEST" : "LIVE"} key, ${session.scope} scope` +
      (session.communityId ? `, community ${session.communityId}` : "") +
      ` — ${filtered.registered.length} tools, mode=${config.mode}`,
  );
  if (!session.writesPermitted && session.writesWithheldReason) {
    console.error(`nimbio-mcp: write tools withheld — ${session.writesWithheldReason}`);
  }

  const server = createServer(client, session, config);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`nimbio-mcp: ${err.message}`);
  } else {
    console.error("nimbio-mcp: failed to start —", err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
