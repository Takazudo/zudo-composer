import { useEffect, useRef, useState } from "preact/hooks";
import { PlusIcon } from "../icons";
import { Button, Input, cx } from "../ui";
import { useOutlineTree } from "./outline-context";
import { isSameTarget } from "./tree-model";
import type { OutlineInsertTarget, OutlineNode } from "./types";

interface InlineEditorProps {
  target: OutlineInsertTarget;
  depth: number;
  /** Doubles as the placeholder and the input's accessible name. */
  label: string;
  variant?: "root";
}

/**
 * Input + Add/Cancel, committed with Enter and abandoned with Escape.
 *
 * It carries no positioning of its own: inside an insert point the stylesheet
 * floats it on the row boundary, and in place of an "Add …" row it stays in
 * flow at exactly that row's height. Either way no row moves.
 */
function OutlineInlineEditor({ target, depth, label, variant }: InlineEditorProps) {
  const tree = useOutlineTree();
  // `Input` omits `ref` from its props, so the editor takes the focus from its
  // own wrapper rather than reaching into that component's API.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const title = value.trim();

  useEffect(() => {
    wrapperRef.current?.querySelector("input")?.focus();
  }, []);

  function commit() {
    if (title === "") return;
    tree.commitAdd(target, title);
  }

  return (
    <div
      ref={wrapperRef}
      class={cx("cms-tree-inline", variant === "root" && "cms-tree-inline--root")}
      style={{ "--depth": String(depth) }}
    >
      <Input
        size="sm"
        value={value}
        placeholder={label}
        aria-label={label}
        onInput={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
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
      <Button variant="primary" size="sm" disabled={title === ""} onClick={commit}>
        Add
      </Button>
      <Button variant="ghost" size="sm" onClick={() => tree.cancelEdit()}>
        Cancel
      </Button>
    </div>
  );
}

interface InsertGapProps {
  target: OutlineInsertTarget;
  depth: number;
  /** The row the gap sits above — it names the button. */
  beforeTitle: string;
  /** Between two root categories, where there is no connector column. */
  root?: boolean;
}

/**
 * The zero-height container between two sibling rows.
 *
 * Nothing inside it takes part in flow: the hit zone, the dashed line, the `+`
 * tile and the inline editor are all absolutely positioned on the boundary, so
 * inserting one of these between every pair of rows costs no height and
 * hovering or editing shifts nothing.
 */
export function OutlineInsertGap({ target, depth, beforeTitle, root }: InsertGapProps) {
  const tree = useOutlineTree();
  if (!tree.canInsert(target)) return null;
  const editing = isSameTarget(tree.editing, target);
  const label = `Insert before ${beforeTitle}`;

  return (
    <div
      class={cx("cms-tree-insert", root && "cms-tree-insert--root", editing && "is-active")}
      style={{ "--depth": String(depth) }}
    >
      <span class="cms-tree-insert__hit" aria-hidden="true" />
      <button class="cms-tree-insert__btn" type="button" aria-label={label} onClick={() => tree.requestInsert(target)}>
        <PlusIcon size="sm" />
      </button>
      {editing ? <OutlineInlineEditor target={target} depth={depth} label={label} /> : null}
    </div>
  );
}

interface AddRowProps {
  parent: OutlineNode;
  target: OutlineInsertTarget;
  depth: number;
}

/**
 * The terminal "Add …" row that closes a children list. It always sits last,
 * so it — not the node above it — carries `is-last`.
 */
export function OutlineAddRow({ parent, target, depth }: AddRowProps) {
  const tree = useOutlineTree();
  if (!tree.canInsert(target)) return null;
  const label = tree.addLabel(parent);

  return (
    <div class="cms-tree-add-wrap is-last" style={{ "--depth": String(depth) }}>
      <span class="cms-tree-vline" />
      <span class="cms-tree-hline" />
      {isSameTarget(tree.editing, target) ? (
        <OutlineInlineEditor target={target} depth={depth} label={label} />
      ) : (
        <button class="cms-tree-add" type="button" onClick={() => tree.requestInsert(target)}>
          <span class="cms-tree-add__btn" aria-hidden="true">
            <PlusIcon size="xs" />
          </span>
          {label}
        </button>
      )}
    </div>
  );
}

/** The dashed full-width button that appends a new root category. */
export function OutlineAddRoot({ target }: { target: OutlineInsertTarget }) {
  const tree = useOutlineTree();
  if (!tree.canInsert(target)) return null;
  const label = tree.addLabel(null);

  if (isSameTarget(tree.editing, target)) {
    return <OutlineInlineEditor target={target} depth={0} label={label} variant="root" />;
  }
  return (
    <button class="cms-tree-add-root" type="button" onClick={() => tree.requestInsert(target)}>
      <PlusIcon size="sm" />
      {label}
    </button>
  );
}
