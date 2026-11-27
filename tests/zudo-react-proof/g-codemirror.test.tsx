import { afterEach, expect, it, vi } from "vitest";
import { flush, getScope, Show, signal, type Ref, type Signal } from "@takazudo/zfb/zudo-react";
import type { MarkdownEditorController } from "../../src/features/content/markdown-source";
import { mountOwned, type OwnedRoot } from "./support/root";

const roots: OwnedRoot[] = [];
afterEach(() => { for (const root of roots.splice(0)) root.stop(); });

const ledger: { created: number; destroyed: number; failure?: unknown } = { created: 0, destroyed: 0 };
let gate: Promise<void> = Promise.resolve();

function MarkdownField(props: { value: Signal<string>; identity: string }) {
  const scope = getScope();
  const parent: Ref<HTMLDivElement> = { current: null };
  let controller: MarkdownEditorController | null = null;
  scope.onCleanup(() => {
    if (!controller) return;
    controller.destroy();
    controller = null;
    ledger.destroyed++;
  });
  scope.onActivate(() => {
    // Late async import: the scope may be gone before the module arrives.
    void gate.then(() => import("../../src/features/content/markdown-source")).then(({ createMarkdownEditor }) => {
      if (scope.abortSignal.aborted || !parent.current) return;
      controller = createMarkdownEditor({
        parent: parent.current,
        value: props.value.value,
        labelledBy: `label-${props.identity}`,
        theme: "light",
        onChange: (next) => { props.value.value = next; },
      });
      ledger.created++;
    }, (error: unknown) => { ledger.failure = error; });
  });
  scope.effect(() => {
    const next = props.value.value;
    controller?.setValue(next);
  });
  return <div ref={parent} class="cm-host" data-identity={props.identity} />;
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
  await flush();
}

it("(g) CodeMirror is created once per visit, edits both ways, and is destroyed exactly once", async () => {
  ledger.created = ledger.destroyed = 0;
  const visible = signal(true);
  const value = signal("# Title");
  function Page() {
    return <section><Show when={visible}>{() => <MarkdownField value={value} identity="entry-1" />}</Show></section>;
  }
  const root = mountOwned(Page, {});
  roots.push(root);
  await vi.waitFor(() => expect(ledger.created).toBe(1), { timeout: 10_000 });
  await flush();
  expect(ledger).toEqual({ created: 1, destroyed: 0 });
  const content = () => root.host.querySelector(".cm-content")!.textContent;
  expect(content()).toBe("# Title");

  // Editor -> signal
  const view = (await import("@codemirror/view")).EditorView.findFromDOM(root.host.querySelector(".cm-editor") as HTMLElement)!;
  view.dispatch({ changes: { from: view.state.doc.length, insert: " edited" } });
  expect(value.value).toBe("# Title edited");
  // Signal -> editor (external write)
  value.value = "replaced";
  await flush();
  expect(view.state.doc.toString()).toBe("replaced");

  // Revisit: leave and return.
  visible.value = false;
  await flush();
  expect(ledger).toEqual({ created: 1, destroyed: 1 });
  visible.value = true;
  await vi.waitFor(() => expect(ledger.created).toBe(2), { timeout: 10_000 });
  await flush();
  expect(ledger).toEqual({ created: 2, destroyed: 1 });
  expect(root.host.querySelectorAll(".cm-editor")).toHaveLength(1);

  root.stop();
  roots.length = 0;
  expect(ledger).toEqual({ created: 2, destroyed: 2 });
});

it("(g) leaving before the async import resolves never creates an editor", async () => {
  ledger.created = ledger.destroyed = 0;
  let release!: () => void;
  gate = new Promise((resolve) => { release = resolve; });
  const visible = signal(true);
  const value = signal("draft");
  function Page() {
    return <section><Show when={visible}>{() => <MarkdownField value={value} identity="entry-2" />}</Show></section>;
  }
  const root = mountOwned(Page, {});
  roots.push(root);
  visible.value = false;
  await flush();
  release();
  // The module is already cached from the previous test; let its promise chain run.
  await settle();
  await import("../../src/features/content/markdown-source");
  await settle();
  gate = Promise.resolve();
  expect(ledger).toEqual({ created: 0, destroyed: 0 });
  expect(ledger.failure).toBeUndefined();
  expect(document.querySelector(".cm-editor")).toBeNull();
});
