import { computed, getScope, Show, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { PlusIcon } from "../icons";
import { Button, Input, cx, isComposingKey } from "../ui";
import type { OutlineTreeState } from "./outline-tree-state";
import { isSameTarget } from "./tree-model";
import type { OutlineInsertTarget, OutlineNode } from "./types";

interface InlineEditorProps {
  tree: OutlineTreeState;
  target: ReadonlySignal<OutlineInsertTarget>;
  depth: number;
  /** Doubles as the placeholder and the input's accessible name. */
  label: ReadonlySignal<string>;
  variant?: "root";
}

/**
 * Input + Add/Cancel, committed with Enter and abandoned with Escape.
 *
 * It carries no positioning of its own: inside an insert point the stylesheet
 * floats it on the row boundary, and in place of an "Add …" row it stays in
 * flow at exactly that row's height. Either way no row moves.
 */
function OutlineInlineEditor({ tree, target, depth, label, variant }: InlineEditorProps) {
  const inputRef: Ref<HTMLInputElement> = { current: null };
  const value = signal("");
  const title = computed(() => value.value.trim());
  let composing = false;

  getScope().onActivate(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    // Native listeners with explicit teardown, so composition tracking ends
    // exactly when the editor does.
    const start = () => { composing = true; };
    const end = () => { composing = false; };
    input.addEventListener("compositionstart", start);
    input.addEventListener("compositionend", end);
    input.focus();
    return () => {
      input.removeEventListener("compositionstart", start);
      input.removeEventListener("compositionend", end);
    };
  });

  function commit() {
    if (title.value === "") return;
    tree.commitAdd(target.value, title.value);
  }

  return (
    <div class={cx("cms-tree-inline", variant === "root" && "cms-tree-inline--root")} style={`--depth:${depth}`}>
      <Input
        size="sm"
        elementRef={inputRef}
        modelValue={value}
        placeholder={label}
        aria-label={label}
        on:keydown={(event: KeyboardEvent) => {
          event.stopPropagation();
          if (composing || isComposingKey(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            tree.cancelEdit();
          }
        }}
      />
      <Button variant="primary" size="sm" disabled={computed(() => title.value === "")} on:click={commit}>
        Add
      </Button>
      <Button variant="ghost" size="sm" on:click={() => tree.cancelEdit()}>
        Cancel
      </Button>
    </div>
  );
}

interface InsertGapProps {
  tree: OutlineTreeState;
  target: ReadonlySignal<OutlineInsertTarget>;
  depth: number;
  /** The row the gap sits above — it names the button. */
  beforeTitle: ReadonlySignal<string>;
  /** Between two root categories, where there is no connector column. */
  root?: boolean;
}

/**
 * First/between insertion: zero-height for fine pointers, a reserved touch row.
 *
 * Nothing inside it takes part in flow: the hit zone, the dashed line, the `+`
 * tile and the inline editor are all absolutely positioned on the boundary, so
 * inserting one of these between every pair of rows costs no height and
 * hovering or editing shifts nothing. Coarse pointers reserve 44px in flow.
 */
export function OutlineInsertGap({ tree, target, depth, beforeTitle, root }: InsertGapProps) {
  const available = computed(() => tree.canInsert(target.value));
  const editing = computed(() => isSameTarget(tree.editing.value, target.value));
  const label = computed(() => `Insert before ${beforeTitle.value}`);

  return (
    <Show when={available}>
      {() => (
        <div
          class={computed(() => cx("cms-tree-insert", root && "cms-tree-insert--root", isSameTarget(tree.pending.value, target.value) && "is-active"))}
          style={`--depth:${depth}`}
        >
          <span class="cms-tree-insert__hit" aria-hidden="true" />
          <button class="cms-tree-insert__btn" type="button" aria-label={label} on:click={(event) => { event.currentTarget.focus(); tree.requestInsert(target.value); }}>
            <PlusIcon size="sm" />
          </button>
          <Show when={editing}>{() => <OutlineInlineEditor tree={tree} target={target} depth={depth} label={label} />}</Show>
        </div>
      )}
    </Show>
  );
}

/** A terminal add button, registered so focus can return to it after an edit. */
function TerminalButton({ tree, parentId, target, class: className, children }: { tree: OutlineTreeState; parentId: string | null; target: ReadonlySignal<OutlineInsertTarget>; class: ReadonlySignal<string>; children: Child }) {
  const ref: Ref<HTMLButtonElement> = { current: null };
  getScope().onActivate(() => {
    const element = ref.current;
    return element ? tree.registerTerminal(parentId, element) : undefined;
  });
  return <button ref={ref} class={className} type="button" on:click={(event) => { event.currentTarget.focus(); tree.requestInsert(target.value); }}>{children}</button>;
}

interface AddRowProps {
  tree: OutlineTreeState;
  parent: ReadonlySignal<OutlineNode>;
  target: ReadonlySignal<OutlineInsertTarget>;
  depth: number;
}

/**
 * The terminal "Add …" row that closes a children list. It always sits last,
 * so it — not the node above it — carries `is-last`.
 */
export function OutlineAddRow({ tree, parent, target, depth }: AddRowProps) {
  const available = computed(() => tree.canInsert(target.value));
  const editing = computed(() => isSameTarget(tree.editing.value, target.value));
  const label = computed(() => tree.addLabel(parent.value));
  const hint = computed(() => parent.value.hint);

  return (
    <Show when={available}>
      {() => (
        <div class="cms-tree-add-wrap is-last" style={`--depth:${depth}`}>
          <span class="cms-tree-vline" />
          <span class="cms-tree-hline" />
          <Show
            when={editing}
            fallback={() => (
                <TerminalButton tree={tree} parentId={target.value.parentId} target={target} class={computed(() => cx("cms-tree-add", isSameTarget(tree.pending.value, target.value) && "is-active"))}>
                  <span class="cms-tree-add__btn" aria-hidden="true">
                    <PlusIcon size="xs" />
                  </span>
                  {label}
                  {/* The parent slot/document row already carries the allowed-kinds hint
                      (`outline-model.ts`'s `describeRuleDisplay`) — the Add row just echoes
                      it so the affordance names what it accepts without a second lookup. */}
                  <Show when={computed(() => hint.value !== undefined)}>{() => <span class="cms-tree-hint">{computed(() => hint.value ?? "")}</span>}</Show>
                </TerminalButton>
            )}
          >
            {() => <OutlineInlineEditor tree={tree} target={target} depth={depth} label={label} />}
          </Show>
        </div>
      )}
    </Show>
  );
}

/** The dashed full-width button that appends a new root category. */
export function OutlineAddRoot({ tree, target }: { tree: OutlineTreeState; target: ReadonlySignal<OutlineInsertTarget> }) {
  const available = computed(() => tree.canInsert(target.value));
  const editing = computed(() => isSameTarget(tree.editing.value, target.value));
  const label = computed(() => tree.addLabel(null));

  return (
    <Show when={available}>
      {() => (
        <Show
          when={editing}
          fallback={() => (
              <TerminalButton tree={tree} parentId={null} target={target} class={computed(() => cx("cms-tree-add-root", isSameTarget(tree.pending.value, target.value) && "is-active"))}>
                <PlusIcon size="sm" />
                {label}
              </TerminalButton>
          )}
        >
          {() => <OutlineInlineEditor tree={tree} target={target} depth={0} label={label} variant="root" />}
        </Show>
      )}
    </Show>
  );
}
