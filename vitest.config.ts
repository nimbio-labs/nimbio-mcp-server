import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/version.ts"],
      // Set just below what the suite achieves, so a regression fails the build.
      //
      // Branches sits lower than the rest on purpose. Most uncovered branches
      // are optional-argument permutations — every `args.x as T | undefined`
      // is a branch, and a tool with six optional filters has 64 of them.
      // Enumerating those would inflate the number without testing anything
      // the handler tests do not already cover; the logic that matters (the
      // mode gate, the confirmation paths, error normalization, redaction) is
      // covered directly.
      thresholds: { lines: 95, functions: 90, branches: 68, statements: 95 },
    },
  },
});
