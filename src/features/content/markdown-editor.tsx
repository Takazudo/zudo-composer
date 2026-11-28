import { computed, getScope, signal, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import {
  BoldIcon,
  HeadingIcon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  MarkdownIcon,
  QuoteIcon,
} from "../../components/icons";
import { read, toSignal, type MaybeSignal } from "../../components/reactive";
import { Button, SegmentedControl } from "../../components/ui";
import { createDomId } from "../../components/use-dom-id";
import { Keyed } from "../../runtime";
import type { ResolvedTheme } from "../../theme/theme";
import { resolvedThemeSignal } from "../../theme/use-resolved-theme";
import { applyMarkdownFormat, type MarkdownFormat } from "./markdown-formatting";
import type { MarkdownEditorController } from "./markdown-source";
export { createMarkdownEditor } from "./markdown-source";
export type { CreateMarkdownEditorOptions, MarkdownEditorController } from "./markdown-source";
import { MarkdownPreview } from "./markdown-preview";

export type MarkdownEditorMode = "edit" | "preview" | "split";

export interface MarkdownEditorProps {
  /** Stable Entry/field identity. Changing it creates a fresh EditorView and history. */
  identity: MaybeSignal<string>;
  value: MaybeSignal<string>;
  label: string;
  required?: boolean;
  /** A signal of the callback always reaches the newest handler. */
  onChange: MaybeSignal<(value: string) => void>;
  initialMode?: MarkdownEditorMode;
  theme?: MaybeSignal<ResolvedTheme>;
}

const actions: readonly {
  format: MarkdownFormat;
  label: string;
  icon: typeof BoldIcon;
}[] = [
  { format: "bold", label: "Bold", icon: BoldIcon },
  { format: "italic", label: "Italic", icon: ItalicIcon },
  { format: "code", label: "Inline code", icon: InlineCodeIcon },
  { format: "heading", label: "Heading", icon: HeadingIcon },
  { format: "link", label: "Link", icon: LinkIcon },
  { format: "quote", label: "Quote", icon: QuoteIcon },
  { format: "list", label: "List", icon: ListIcon },
];

const MODE_OPTIONS = [
  { value: "edit" as const, label: "Edit" },
  { value: "split" as const, label: "Split" },
  { value: "preview" as const, label: "Preview" },
];

interface SourceMountProps {
  value: ReadonlySignal<string>;
  theme: ReadonlySignal<ResolvedTheme>;
  labelId: string;
  required: boolean;
  /** Receives the live controller while this identity's editor exists. */
  attach(controller: MarkdownEditorController | null): void;
  onChange(value: string): void;
}

/**
 * One CodeMirror lifetime. The module is imported late, on activation, so a
 * visit that is left before it arrives creates nothing; otherwise the editor is
 * created exactly once and destroyed exactly once, with the scope.
 */
function SourceMount({ value, theme, labelId, required, attach, onChange }: SourceMountProps) {
  const scope = getScope();
  const parent: Ref<HTMLDivElement> = { current: null };
  let controller: MarkdownEditorController | null = null;
  scope.onCleanup(() => {
    if (!controller) return;
    attach(null);
    controller.destroy();
    controller = null;
  });
  scope.onActivate(() => {
    void import("./markdown-source").then(({ createMarkdownEditor }) => {
      if (scope.abortSignal.aborted || !parent.current) return;
      controller = createMarkdownEditor({ parent: parent.current, value: value.value, labelledBy: labelId, required, theme: theme.value, onChange });
      attach(controller);
    });
  });
  scope.effect(() => {
    const next = value.value;
    controller?.setValue(next);
  });
  scope.effect(() => {
    const next = theme.value;
    controller?.setTheme(next);
  });
  return <div class="sg-content-markdown-editor__mount" ref={parent} />;
}

export function MarkdownEditor({
  identity,
  value: suppliedValue,
  label,
  required = false,
  onChange,
  initialMode = "split",
  theme: suppliedTheme,
}: MarkdownEditorProps) {
  const scope = getScope();
  const theme = suppliedTheme === undefined ? resolvedThemeSignal(scope) : toSignal(suppliedTheme);
  const value = toSignal(suppliedValue);
  const identitySignal = toSignal(identity);
  // Just the label, the way every `Field` in this form names its control: the
  // kind hint beside it is a visual aid, not part of the control's name.
  const labelId = `sg-content-markdown-label-${createDomId()}`;
  const mode = signal<MarkdownEditorMode>(initialMode);
  let controller: MarkdownEditorController | null = null;

  const runFormat = (format: MarkdownFormat): void => {
    if (controller) applyMarkdownFormat(controller.view, format);
  };

  return (
    <section class="sg-content-markdown-editor" data-mode={mode}>
      <div class="sg-content-markdown-editor__heading">
        <span id={labelId} class="sg-content-markdown-editor__label">
          {label}
          {required ? <span class="sg-content-req" aria-hidden="true"> *</span> : null}
        </span>
        <span class="sg-content-markdown-editor__kind">
          <MarkdownIcon size="xs" />
          Rich text (Markdown)
        </span>
      </div>
      <div class="sg-content-markdown-editor__frame">
        <div class="sg-content-markdown-editor__toolbar" role="toolbar" aria-label="Format Markdown">
          {actions.map(({ format, label: actionLabel, icon: Icon }) => (
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              aria-label={actionLabel}
              title={actionLabel}
              // Preview hides the source, so a formatting edit would land where
              // the author cannot see it happen.
              disabled={computed(() => mode.value === "preview")}
              on:pointerdown={(event) => event.preventDefault()}
              on:click={() => runFormat(format)}
            >
              <Icon size="sm" />
            </Button>
          ))}
          <span class="sg-content-markdown-editor__toolbar-gap" />
          <SegmentedControl<MarkdownEditorMode>
            label="Markdown view"
            mode="pressed"
            size="sm"
            value={mode}
            options={MODE_OPTIONS}
            onChange={(next) => { mode.value = next; }}
          />
        </div>
        <div class="sg-content-markdown-editor__workspace">
          <div class="sg-content-markdown-editor__source" hidden={computed(() => mode.value === "preview")}>
            {/* One editor/history lifetime belongs to exactly one Entry/field identity. */}
            <Keyed value={identitySignal} by={(id) => id}>{() => (
              <SourceMount
                value={value}
                theme={theme}
                labelId={labelId}
                required={required}
                attach={(next) => { controller = next; }}
                onChange={(next) => read(onChange)(next)}
              />
            )}</Keyed>
          </div>
          <div class="sg-content-markdown-editor__preview" hidden={computed(() => mode.value === "edit")} aria-label={`${label} formatted preview`}>
            <div class="sg-content-markdown-editor__preview-label">Formatted text</div>
            <MarkdownPreview markdown={value} />
          </div>
        </div>
      </div>
    </section>
  );
}
