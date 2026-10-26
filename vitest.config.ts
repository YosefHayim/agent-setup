import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // imageToCode/scripts is its own package with its own runner; src/scripts/dev is local scratch.
    exclude: ["**/node_modules/**", "**/dist/**", "src/skills/imageToCode/scripts/**", "src/scripts/dev/**"],
    // Hook and CLI tests spawn these sources as child processes, so Vitest's import graph never links them to a test.
    forceRerunTriggers: [
      "**/package.json/**",
      "**/{vitest,vite}.config.*/**",
      "**/src/hooks/**/*.ts",
      "**/src/cli/**/*.ts",
    ],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Install round-trips run beside CLI help spawns; the 5s default flakes under parallel load.
    testTimeout: 30_000,
  },
});
