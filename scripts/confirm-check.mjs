/**
 * Exercise the two-step confirmation fallback against a live API.
 *
 * This client deliberately does NOT declare the elicitation capability, so it
 * takes the token path — the branch that is hardest to reason about.
 *
 * Usage: NIMBIO_API_KEY=nimbio_test_... NIMBIO_ENV=dev NIMBIO_MCP_MODE=write \
 *          node scripts/confirm-check.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath, args: ["dist/index.js"], env: { ...process.env }, stderr: "inherit",
});
const client = new Client({ name: "confirm-check", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const writes = tools.filter((t) => t.annotations?.readOnlyHint === false);
console.log(`tools=${tools.length} writes=${writes.length}`);
console.log(`confirm-gated (accept confirmation_token): ${
  tools.filter((t) => "confirmation_token" in (t.inputSchema?.properties ?? {})).map((t) => t.name).join(", ")}`);

// Find a real latch id.
const gs = await client.callTool({ name: "nimbio_gate_status", arguments: {} });
const latchId = gs.structuredContent.latches[0].latch_id;
console.log(`\nlatch: ${latchId}`);

console.log("\n--- call 1: nimbio_open_gate with NO token ---");
const first = await client.callTool({ name: "nimbio_open_gate", arguments: { latch_id: latchId } });
console.log(first.content[0].text);
const token = first.structuredContent?.confirmation_token;
console.log(`token issued: ${token ? "yes" : "NO"}`);

console.log("\n--- call 2: WRONG args + that token (should refuse) ---");
const wrong = await client.callTool({
  name: "nimbio_open_gate",
  arguments: { latch_id: latchId, note: "changed the args", confirmation_token: token },
});
console.log(`isError=${wrong.isError} :: ${wrong.content[0].text.slice(0, 110)}`);

console.log("\n--- call 3: fresh token, correct args (should open, simulated) ---");
const preview = await client.callTool({ name: "nimbio_open_gate", arguments: { latch_id: latchId } });
const t2 = preview.structuredContent.confirmation_token;
const done = await client.callTool({
  name: "nimbio_open_gate",
  arguments: { latch_id: latchId, confirmation_token: t2 },
});
console.log(done.content[0].text);

console.log("\n--- call 4: reuse the spent token (should refuse) ---");
const reuse = await client.callTool({
  name: "nimbio_open_gate",
  arguments: { latch_id: latchId, confirmation_token: t2 },
});
console.log(`isError=${reuse.isError} :: ${reuse.content[0].text.slice(0, 90)}`);

await client.close();
