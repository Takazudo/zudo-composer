// The packages/ui component tests were ported unmodified from the pinned
// @zudo-sg/ui package, whose own root vitest.setup.ts globally registered
// an afterEach(cleanup) — individual test files rely on it and never call
// cleanup themselves. Importing the zudo-react test adapter registers that
// same afterEach(cleanup) for every ui-pack test file.
import "@testing-library/jest-dom/vitest";
import "../../src/test/render";
