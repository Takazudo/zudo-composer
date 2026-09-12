import { defineConfig } from "vitest/config";

export default defineConfig({
  // Host packs use Preact's automatic JSX runtime while remaining independent
  // of the tool application's virtual module aliases.
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  test: {
    name: "demo-landing",
    include: ["__tests__/**/*.test.?(c|m)[jt]s?(x)"],
    environment: "node",
    testTimeout: 60_000,
  },
});
