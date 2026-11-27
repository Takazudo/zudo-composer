// A slot child reaches its host without context: at activation it dispatches a
// bubbling DOM event from its own element, and the nearest host listening for
// that event answers synchronously. Composer renders slot children opaquely
// (keyed per node), so the host can neither inspect nor re-prop them.
export interface SlotLink<T> {
  readonly type: string;
  /** Type-only marker; never read. */
  readonly value?: T;
}

interface LinkRequest<T> {
  value: T | undefined;
}

export function slotLink<T>(type: string): SlotLink<T> {
  return { type };
}

/** The host's listener for `on:<link.type>`: it answers and stops the request at the nearest host. */
export function answerLink<T>(link: SlotLink<T>, value: T): (event: Event) => void {
  return (event) => {
    if (event.type !== link.type || !(event instanceof CustomEvent)) return;
    event.stopPropagation();
    (event.detail as LinkRequest<T>).value = value;
  };
}

/** Undefined when no ancestor of `from` hosts `link`. */
export function requestLink<T>(link: SlotLink<T>, from: Element | null): T | undefined {
  if (!from) return undefined;
  const detail: LinkRequest<T> = { value: undefined };
  from.dispatchEvent(new CustomEvent(link.type, { bubbles: true, detail }));
  return detail.value;
}
