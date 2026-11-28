import { getScope, signal, type Child } from "@takazudo/zfb/zudo-react";
import { read, type MaybeSignal } from "../../../../components/reactive";
import { Field, Input, Textarea } from "../../../../components/ui";

export type PageTextProperty = "title" | "slug" | "notes";

export interface PageTextFieldProps {
  prop: PageTextProperty;
  label: string;
  value: MaybeSignal<string>;
  help?: Child;
  kind?: Child;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
  onCommit: (prop: PageTextProperty, value: string) => void;
  onFlushPending?: () => void;
}

/**
 * Local draft state is deliberately guarded while focused. Together with the
 * selected-page key applied by the inspector, this prevents a stored value
 * arriving from replacing the control's text and moving its caret while typing.
 */
function createTextField(value: MaybeSignal<string>, onCommit: (value: string) => void) {
  const draft = signal(read(value));
  let focused = false;

  getScope().effect(() => {
    const next = read(value);
    if (!focused && draft.value !== next) draft.value = next;
  });

  return {
    draft,
    onInput(next: string) {
      draft.value = next;
      onCommit(next);
    },
    onFocus() {
      focused = true;
    },
    onBlur() {
      focused = false;
    },
  };
}

export function PageTextField({
  prop,
  label,
  value,
  help,
  kind,
  placeholder,
  multiline = false,
  mono = false,
  onCommit,
  onFlushPending,
}: PageTextFieldProps): Child {
  const text = createTextField(value, (next) => onCommit(prop, next));
  const onBlur = () => {
    onFlushPending?.();
    text.onBlur();
  };

  return (
    <Field label={label} help={help} kind={kind}>
      {(field) => multiline ? (
        <Textarea
          field={field}
          modelValue={text.draft}
          placeholder={placeholder}
          rows={4}
          on:focus={text.onFocus}
          on:blur={onBlur}
          on:input={(event) => text.onInput(event.currentTarget.value)}
        />
      ) : (
        <Input
          field={field}
          modelValue={text.draft}
          placeholder={placeholder}
          size="sm"
          class={mono ? "sg-sitemapper-mono" : undefined}
          on:focus={text.onFocus}
          on:blur={onBlur}
          on:input={(event) => text.onInput(event.currentTarget.value)}
        />
      )}
    </Field>
  );
}
