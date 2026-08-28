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

// Tools with required arguments need something plausible to be exercised at all.
const ARGS = {
  nimbio_change_log: { type: "hold_open", days: 7 },
  nimbio_key_usage: { from: "2026-08-01", to: "2026-08-28" },
};

const targets = wanted.length ? tools.filter((t) => wanted.includes(t.name)) : tools;
const skipped = [];
for (const t of targets) {
  const required = t.inputSchema?.required ?? [];
  const args = ARGS[t.name] ?? {};
  const missing = required.filter((r) => !(r in args));
  if (missing.length) {
    skipped.push(`${t.name} (needs ${missing.join(", ")})`);
    continue;
  }
  console.log(`\n=== tools/call ${t.name} ===`);
  try {
    const res = await client.callTool({ name: t.name, arguments: args });
    const first = res.content?.[0]?.text ?? "(no text)";
    console.log(first.split("\n").slice(0, 10).join("\n"));
    if (res.isError) console.log("  ^ isError: true");
    console.log(`  structuredContent: ${res.structuredContent ? "present" : "absent"}`);
  } catch (err) {
    console.log(`  THREW: ${err?.message ?? err}`);
  }
}

const { resources } = await client.listResources().catch(() => ({ resources: [] }));
console.log(`\n=== resources/list — ${resources.length} ===`);
for (const r of resources) console.log(`  ${r.uri.padEnd(34)} ${r.title ?? r.name}`);
for (const r of resources) {
  const read = await client.readResource({ uri: r.uri });
  const body = read.contents?.[0]?.text ?? "";
  console.log(`  read ${r.uri} -> ${body.length} bytes`);
}

const { prompts } = await client.listPrompts().catch(() => ({ prompts: [] }));
console.log(`\n=== prompts/list — ${prompts.length} ===`);
for (const p of prompts) console.log(`  ${p.name.padEnd(30)} ${p.title ?? ""}`);

if (skipped.length) console.log(`\nskipped (required args): ${skipped.join("; ")}`);
await client.close();
console.log("\nsmoke: done");
