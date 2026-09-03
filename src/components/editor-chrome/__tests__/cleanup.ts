// The shared vitest config does not enable globals, so @testing-library/preact
// cannot register its own auto-cleanup. Every suite in this folder imports this.
import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

afterEach(cleanup);
