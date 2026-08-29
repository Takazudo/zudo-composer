/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";

export type InspectorTextProperty = "title" | "slug" | "notes";

export interface InspectorFieldProps {
  prop: InspectorTextProperty;
  label: string;
  value: string;
  multiline?: boolean;
  onCommit: (prop: InspectorTextProperty, value: string) => void;
  onFlushPending?: () => void;
}

/**
 * Local draft state is deliberately guarded while focused. Together with the
 * selected-node key applied by InspectorPanel, this prevents controlled parent
 * rerenders from replacing the input and moving its caret while typing.
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

export function InspectorField({
  prop,
  label,
  value,
  multiline = false,
  onCommit,
  onFlushPending,
}: InspectorFieldProps): JSX.Element {
  const id = useId();
  const field = useTextField(value, (next) => onCommit(prop, next));
  const common = {
    id,
    class: "sg-sitemapper-inspector__control",
    value: field.draft,
    onFocus: field.onFocus,
    onBlur: () => {
      field.onBlur();
      onFlushPending?.();
    },
  };

  return (
    <div class="sg-sitemapper-inspector__field">
      <label for={id}>{label}</label>
      {multiline ? (
        <textarea
          {...common}
          rows={5}
          onInput={(event) => {
            if (event.currentTarget instanceof HTMLTextAreaElement) field.onInput(event.currentTarget.value);
          }}
        />
      ) : (
        <input
          {...common}
          type="text"
          onInput={(event) => {
            if (event.currentTarget instanceof HTMLInputElement) field.onInput(event.currentTarget.value);
          }}
        />
      )}
    </div>
  );
}
