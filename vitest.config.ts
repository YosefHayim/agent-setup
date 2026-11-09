import { defineConfig } from "vitest/config";

export default defineConfig({
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
      include: ["src/hooks/leftover-process-cleanup/lib/leftover-process-decision.ts"],
      thresholds: { branches: 100 },
    },
  },
});
