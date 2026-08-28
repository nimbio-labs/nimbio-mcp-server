import { describe, it, expect } from "vitest";
import { endpoints } from "@nimbio/community-api";
import { TOOLS } from "../src/tools/index.js";

/**
 * Every REST operation a tool claims to cover must exist in the SDK's own
 * endpoint registry, and every operation the SDK wraps should be reachable
 * through some tool.
 *
 * The endpoint strings on each tool are what `surface.json` and nimbioCore's
 * parity gate are built from. A hand-written path that drifts from the SDK
 * would make that gate confidently wrong, which is worse than no gate — so
 * this derives the truth from the SDK rather than trusting the strings.
 */
const SENTINELS = ["__P0__", "__P1__", "__P2__", "__P3__"];

/** Segment values that only ever come from a probe argument, not a real path. */
const PROBE_ARTEFACTS = new Set([
  ...SENTINELS,
  "undefined",
  "null",
  "",
  "[object Object]",
  encodeURIComponent("[object Object]"),
]);

function normalise(path: string): string {
  return path
    .split("/")
    // index 0 is the empty string before the leading slash — never a parameter.
    .map((seg, i) => (i > 0 && PROBE_ARTEFACTS.has(seg) ? "{}" : seg))
    .join("/");
}

/** Every way of filling `arity` arguments from the candidate shapes. */
function argCombinations(arity: number): unknown[][] {
  if (arity === 0) return [[]];
  const shapes: ((i: number) => unknown)[] = [(i) => SENTINELS[i], () => [], () => ({})];
  let combos: unknown[][] = [[]];
  for (let i = 0; i < arity; i++) {
    combos = combos.flatMap((prefix) => shapes.map((shape) => [...prefix, shape(i)]));
  }
  return combos;
}

function sdkOperations(): Set<string> {
  const ops = new Set<string>();
  for (const factory of Object.values(endpoints as Record<string, unknown>)) {
    if (typeof factory !== "function") continue;
    // Endpoint factories take path ids first, then options — and some take
    // arrays or objects, which a bare string argument makes throw. Try every
    // arity against every argument shape and keep whatever paths come back.
    for (let arity = 0; arity <= SENTINELS.length; arity++) {
      for (const args of argCombinations(arity)) {
        try {
          const spec = (factory as (...a: unknown[]) => { method: string; path: string })(...args);
          if (spec?.method && spec?.path) ops.add(`${spec.method} ${normalise(spec.path)}`);
        } catch {
          // This shape does not fit; try the next.
        }
      }
    }
  }
  // A path built from a missing id is a probing artefact, not a real operation.
  for (const op of [...ops]) if (op.includes("undefined") || op.includes("null")) ops.delete(op);
  return ops;
}

const OPS = sdkOperations();

/**
 * SDK operations deliberately not reachable as a tool, with the reason.
 * Empty is the goal; an entry here is a decision, not an oversight.
 */
const NOT_EXPOSED: Record<string, string> = {
  "GET /healthz":
    "Service liveness, not a community operation. The server proves reachability by making " +
    "its me() call at startup and failing loudly if it cannot.",
};

describe("declared endpoints", () => {
  it("finds the SDK's endpoint registry", () => {
    expect(OPS.size).toBeGreaterThan(50);
  });

  it("every endpoint a tool declares exists in the SDK", () => {
    const unknown = TOOLS.flatMap((tool) =>
      tool.endpoints.filter((e) => !OPS.has(e)).map((e) => `${tool.name}: ${e}`),
    );
    expect(unknown, `declared but not in the SDK registry:\n${unknown.join("\n")}`).toEqual([]);
  });

  it("every SDK operation is reachable through some tool", () => {
    const declared = new Set(TOOLS.flatMap((t) => t.endpoints));
    const uncovered = [...OPS].filter((op) => !declared.has(op) && !(op in NOT_EXPOSED)).sort();
    expect(
      uncovered,
      `these SDK operations have no tool. Expose one, or record why in NOT_EXPOSED:\n${uncovered.join("\n")}`,
    ).toEqual([]);
  });
});
