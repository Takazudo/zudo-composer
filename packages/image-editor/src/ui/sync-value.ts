import { getScope, type ReadonlySignal, type Ref } from '@takazudo/zfb/zudo-react';
/**
 * Numeric and range inputs carry no model in zudo-react: they take a static
 * `value` plus `on:input`. This writes the document's value back into the DOM
 * whenever it changes (undo, reset, presets, clamping), as a controlled input did.
 */
export function syncInputValue(ref: Ref<HTMLInputElement>, value: ReadonlySignal<string>): void {
  getScope().effect(() => {
    const next = value.value;
    const element = ref.current;
    if (element && element.value !== next) element.value = next;
  });
}
