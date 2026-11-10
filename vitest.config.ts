import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves "#src/*" to src/ (see package.json "imports"), the same as tsx run with --conditions=source.
  // Vitest's node tests run in Vite's SSR environment, which reads ssr.resolve.conditions (not the root resolve).
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["src/**/*.test.ts"],
    // imageToCode/scripts is its own package with its own runner; src/scripts/dev is local scratch.
    exclude: ["**/node_modules/**", "**/dist/**", "src/skills/image-to-code/scripts/**", "src/scripts/dev/**"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Install round-trips run beside CLI help spawns; the 5s default flakes under parallel load.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/hooks/leftover-process-cleanup/leftover-process-decision.ts"],
      thresholds: { branches: 100 },
    },
  },
});
