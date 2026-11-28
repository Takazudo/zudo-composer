import { getScope, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { storeSignal } from "../../runtime";
import type { MappingEditorController, MappingEditorState } from "./controller";

/**
 * Keeps an uncontrolled `<input>` (number, date, colour) in step with an
 * external value without a model: those controls take a static `value`, and
 * a draft the author is still typing is never overwritten while focused.
 */
export function writeDomValue(ref: { current: HTMLInputElement | null }, external: () => string): void {
  getScope().effect(() => {
    const next = external();
    const element = ref.current;
    if (!element || element.value === next || element === element.ownerDocument.activeElement) return;
    element.value = next;
  });
}

/** The controller as an external store: its `subscribe` replays the current state, which the signal absorbs. */
export function mappingStateSignal(controller: MappingEditorController): ReadonlySignal<MappingEditorState> {
  return storeSignal(getScope(), {
    getSnapshot: () => controller.state,
    subscribe: (listener) => controller.subscribe(() => listener()),
  });
}
