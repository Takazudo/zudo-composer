import { afterEach, expect, it } from "vitest";
import { ErrorBoundary, flush, getScope } from "@takazudo/zfb/zudo-react";
import { mountOwned, type OwnedRoot } from "../../src/runtime/root";

const roots: OwnedRoot[] = [];
afterEach(() => { for (const root of roots.splice(0)) root.stop(); });

it("(h) a local fallback with Retry resets only the failing subtree", async () => {
  const events: string[] = [];
  let failing = true;
  function Preview() {
    const scope = getScope();
    events.push("preview setup");
    scope.onCleanup(() => events.push("preview cleanup"));
    if (failing) throw new Error("renderer unavailable");
    return <p class="preview">rendered</p>;
  }
  function Sibling() {
    getScope().onCleanup(() => events.push("sibling cleanup"));
    return <input class="sibling" aria-label="title" />;
  }
  function Workspace() {
    return (
      <main>
        <Sibling />
        <ErrorBoundary
          children={() => <Preview />}
          fallback={(error, reset) => (
            <div role="alert">
              {error instanceof Error ? error.message : "failed"}
              <button type="button" on:click={() => reset()}>Retry</button>
            </div>
          )}
        />
      </main>
    );
  }
  const root = mountOwned(Workspace, {});
  roots.push(root);
  expect(root.handle).not.toBeNull();
  expect(root.host.querySelector("[role=alert]")!.textContent).toContain("renderer unavailable");
  const sibling = root.host.querySelector<HTMLInputElement>(".sibling")!;
  sibling.value = "typed";
  sibling.focus();

  failing = false;
  root.host.querySelector<HTMLButtonElement>("[role=alert] button")!.click();
  await flush();
  expect(root.host.querySelector("[role=alert]")).toBeNull();
  expect(root.host.querySelector(".preview")!.textContent).toBe("rendered");
  expect(root.host.querySelector(".sibling")).toBe(sibling);
  expect(sibling.value).toBe("typed");
  expect(document.activeElement).toBe(sibling);
  expect(events).toEqual(["preview setup", "preview cleanup", "preview setup"]);
});
