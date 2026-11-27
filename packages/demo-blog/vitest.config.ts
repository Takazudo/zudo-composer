import { defineConfig } from "vitest/config";

export default defineConfig({
  // Host packs use the zudo-react automatic JSX runtime while remaining independent
  // of the tool application's virtual module aliases.
  oxc: { jsx: { runtime: "automatic", importSource: "@takazudo/zfb/zudo-react" } },
  test: {
    name: "demo-blog",
    include: ["__tests__/**/*.test.?(c|m)[jt]s?(x)"],
    environment: "node",
    testTimeout: 60_000,
  },
});
