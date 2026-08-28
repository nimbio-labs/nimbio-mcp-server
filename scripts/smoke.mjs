/**
 * Drive the built server over stdio the way a real MCP host would.
 *
 * Usage:  NIMBIO_API_KEY=... NIMBIO_ENV=dev node scripts/smoke.mjs [tool ...]
 *
 * With no tool names it lists the surface and calls every read-only tool.
 * This is a live check against a real API — point it at a nimbio_test_* key.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const wanted = process.argv.slice(2);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env },
  stderr: "inherit",
});

const client = new Client({ name: "nimbio-smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`\n=== tools/list — ${tools.length} tool(s) ===`);
for (const t of tools) {
  const a = t.annotations ?? {};
  console.log(`  ${t.name.padEnd(28)} readOnly=${a.readOnlyHint ?? "?"}  ${t.title ?? ""}`);
}

const targets = wanted.length ? tools.filter((t) => wanted.includes(t.name)) : tools;
for (const t of targets) {
  console.log(`\n=== tools/call ${t.name} ===`);
  try {
    const res = await client.callTool({ name: t.name, arguments: {} });
    const first = res.content?.[0]?.text ?? "(no text)";
    console.log(first.split("\n").slice(0, 10).join("\n"));
    if (res.isError) console.log("  ^ isError: true");
    console.log(`  structuredContent: ${res.structuredContent ? "present" : "absent"}`);
  } catch (err) {
    console.log(`  THREW: ${err?.message ?? err}`);
  }
}

await client.close();
console.log("\nsmoke: done");
