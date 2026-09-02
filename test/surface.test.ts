/**
 * Machine-readable tool surface.
 *
 * `surface.json` at the repo root is a checked-in, generated description of
 * every REST operation this server exposes and the tools that reach it. It is
 * what nimbioCore's `./nimbio.sh sdk-parity --include mcp` diffs against the
 * public API's OpenAPI spec, so that an operation the SDKs gain but no tool
 * exposes becomes visible instead of silent — the failure the SDKs themselves
 * already had once.
 *
 * It is derived by introspecting the tool registry, never hand-maintained. The
 * `endpoints` array deliberately matches the shape the two SDKs emit, so the
 * parity script reads all three the same way.
 *
 * This lives in the test suite for the same reason the npm SDK's does: vitest
 * already runs TypeScript in Node, so the generator rides along with the
 * staleness guard rather than needing its own runner.
 *
 * Regenerate after changing the registry:
 *
 *   npm run surface        # == UPDATE_SURFACE=1 vitest run test/surface.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/tools/index.js";
import { VERSION } from "../src/version.js";

const SURFACE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "surface.json");

interface SurfaceEndpoint {
  method: string;
  path: string;
  /** Every tool that reaches this operation. */
  tools: string[];
}

interface SurfaceTool {
  name: string;
  scope: string;
  capability: string | null;
  readOnly: boolean;
  destructive: boolean;
  confirms: boolean;
  endpoints: string[];
}

interface Surface {
  client: string;
  /** `consumer`: a subset of the SDK surface is expected, unlike an SDK. */
  class: string;
  package: string;
  version: string;
  endpoints: SurfaceEndpoint[];
  tools: SurfaceTool[];
}

function buildSurface(): Surface {
  const byOperation = new Map<string, string[]>();
  for (const tool of TOOLS) {
    for (const endpoint of tool.endpoints) {
      byOperation.set(endpoint, [...(byOperation.get(endpoint) ?? []), tool.name]);
    }
  }

  const endpoints: SurfaceEndpoint[] = [...byOperation.entries()]
    .map(([operation, tools]) => {
      const [method, ...rest] = operation.split(" ");
      return { method: method!, path: rest.join(" "), tools: [...tools].sort() };
    })
    .sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));

  return {
    client: "mcp",
    class: "consumer",
    package: "@nimbio/mcp-server",
    version: VERSION,
    endpoints,
    // Registry order, not alphabetical: the order tools are offered in is
    // itself part of the surface, and a reshuffle should show up in the diff.
    tools: TOOLS.map((t) => ({
      name: t.name,
      scope: t.scope ?? "community",
      capability: t.capability ?? null,
      readOnly: t.annotations.readOnlyHint,
      destructive: t.annotations.destructiveHint ?? false,
      confirms: Boolean(t.confirm),
      endpoints: [...t.endpoints].sort(),
    })),
  };
}

function renderSurface(): string {
  return `${JSON.stringify(buildSurface(), null, 2)}\n`;
}

describe("surface.json", () => {
  it("matches the tool registry", () => {
    const generated = renderSurface();
    if (process.env.UPDATE_SURFACE === "1") {
      writeFileSync(SURFACE_PATH, generated, "utf8");
      return;
    }
    expect(
      readFileSync(SURFACE_PATH, "utf8"),
      "surface.json is stale — run `npm run surface`",
    ).toBe(generated);
  });

  it("lists every tool exactly once", () => {
    const names = buildSurface().tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(TOOLS.map((t) => t.name));
  });

  it("declares the version the package declares", () => {
    const pkg = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
    );
    expect(buildSurface().version).toBe(pkg.version);
  });

  it("records which tools reach each operation", () => {
    const surface = buildSurface();
    for (const endpoint of surface.endpoints) {
      expect(endpoint.tools.length, `${endpoint.method} ${endpoint.path}`).toBeGreaterThan(0);
      for (const name of endpoint.tools) {
        expect(TOOLS.some((t) => t.name === name)).toBe(true);
      }
    }
  });

  it("marks itself a consumer, not an SDK", () => {
    // The parity gate holds consumers to subset semantics: an unexposed
    // operation is a recorded decision, not an automatic failure.
    expect(buildSurface().class).toBe("consumer");
  });
});
