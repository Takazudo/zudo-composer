// The colocated component tests were ported unmodified from the pinned
// @zudo-sg/ui package, whose own root vitest.setup.ts globally registered
// this afterEach(cleanup) — individual test files rely on it and never call
// cleanup themselves. Kept here so the ported tests behave the same.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

afterEach(cleanup);
