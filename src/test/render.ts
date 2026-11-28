// Test adapter replacing @testing-library/preact's render/act/cleanup for
// zudo-react components. Import queries, `screen` and `fireEvent` from here so
// they share the @testing-library/dom instance `render` binds to.
import { flush, type Child, type Diagnostic } from "@takazudo/zfb/zudo-react";
import { within, type BoundFunctions, type queries } from "@testing-library/dom";
import { afterEach } from "vitest";
import { mountOwnedChild, type OwnedRoot } from "../runtime/root";

export { configure, fireEvent, screen, waitFor, within } from "@testing-library/dom";

export const TEST_ROOT_IDENTITY = Object.freeze({ component: "ComposerTestRoot", build: "composer-test" });

export interface RenderOptions {
  /** Element the root host is appended to. Defaults to `document.body`. */
  parent?: Element;
  /** Aborting before commit cancels the mount; `render` then throws. */
  signal?: AbortSignal;
}

export interface RenderResult extends BoundFunctions<typeof queries> {
  /** The root's wrapper element; queries are bound to it. */
  readonly container: HTMLElement;
  readonly diagnostics: readonly Diagnostic[];
  /** Unmounts the root and removes its container. Idempotent. */
  unmount(): void;
}

const mounted = new Set<OwnedRoot>();

/**
 * Mount `child` in a fresh caller-owned root. There is no `rerender`: pass
 * signals, assign them, then `await settle()`. A refused mount throws with its
 * diagnostic codes; diagnostics from a successful mount stay on the result.
 */
export function render(child: Child, options: RenderOptions = {}): RenderResult {
  const root = mountOwnedChild(child, { identity: TEST_ROOT_IDENTITY, parent: options.parent, signal: options.signal });
  if (!root.handle) {
    root.stop();
    throw new Error(`render: mount refused (${root.diagnostics.map((diagnostic) => diagnostic.code).join(", ") || "no diagnostic"})`);
  }
  mounted.add(root);
  return {
    container: root.host,
    diagnostics: root.diagnostics,
    ...within(root.host),
    unmount() {
      root.stop();
      mounted.delete(root);
    },
  };
}

/** Replacement for `act()`: resolves once the scheduler's DOM and effect queues are quiet. */
export function settle(): Promise<void> {
  return flush();
}

/**
 * `settle()` after one macrotask: lets already-resolved I/O (fetch mocks,
 * timers at 0 ms) land first. Not for fake timers; use `settle()` there.
 */
export async function settleTasks(): Promise<void> {
  await flush();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await flush();
}

/** Unmounts every root `render` created. Registered after each test automatically. */
export function cleanup(): void {
  for (const root of mounted) root.stop();
  mounted.clear();
}

afterEach(cleanup);
