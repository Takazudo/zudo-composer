/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Field, Input, Textarea } from "../../../../components/ui";

export type PageTextProperty = "title" | "slug" | "notes";

export interface PageTextFieldProps {
  prop: PageTextProperty;
  label: string;
  value: string;
  help?: ComponentChildren;
  kind?: ComponentChildren;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
  onCommit: (prop: PageTextProperty, value: string) => void;
  onFlushPending?: () => void;
}

/**
 * Local draft state is deliberately guarded while focused. Together with the
 * selected-page key applied by the inspector, this prevents controlled parent
 * rerenders from replacing the control and moving its caret while typing.
 */
function useTextField(value: string, onCommit: (value: string) => void) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  return {
    draft,
    onInput(next: string) {
      setDraft(next);
      onCommit(next);
    },
    onFocus() {
      focusedRef.current = true;
    },
    onBlur() {
      focusedRef.current = false;
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
}: PageTextFieldProps): JSX.Element {
  const field = useTextField(value, (next) => onCommit(prop, next));
  const shared = {
    value: field.draft,
    placeholder,
    onFocus: field.onFocus,
    onBlur: () => {
      field.onBlur();
      onFlushPending?.();
    },
  };

  return (
    <Field label={label} help={help} kind={kind}>
      {multiline ? (
        <Textarea
          {...shared}
          rows={4}
          onInput={(event) => field.onInput(event.currentTarget.value)}
        />
      ) : (
        <Input
          {...shared}
          size="sm"
          class={mono ? "sg-sitemapper-mono" : undefined}
          onInput={(event) => field.onInput(event.currentTarget.value)}
        />
      )}
    </Field>
  );
}
