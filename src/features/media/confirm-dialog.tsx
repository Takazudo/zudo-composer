import type { JSX } from "preact";
import { useEffect, useId, useLayoutEffect, useRef } from "preact/hooks";
export interface MediaConfirmDialogProps { open: boolean; title: string; confirmLabel: string; children: preact.ComponentChildren; onConfirm(): void; onClose(): void }
export function MediaConfirmDialog({ open, title, confirmLabel, children, onConfirm, onClose }: MediaConfirmDialogProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLElement | null>(null); const titleId = useId();
  useLayoutEffect(() => { if (open) trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open");
    }
  }, [open]);
  function close(): void { if (typeof ref.current?.close === "function") ref.current.close(); else ref.current?.removeAttribute("open"); onClose(); setTimeout(() => trigger.current?.focus(), 0); }
  return <dialog ref={ref} class="sg-media-dialog" aria-modal={open ? "true" : undefined} aria-labelledby={open ? titleId : undefined} onCancel={(event) => { event.preventDefault(); close(); }} onKeyDown={(event) => { if (event.key !== "Tab") return; const controls = [...(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])]; const first = controls[0]; const last = controls.at(-1); if (!first || !last) return; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }}>
    {open && <div class="sg-media-dialog__surface"><h2 id={titleId}>{title}</h2><div>{children}</div><div class="sg-media-actions"><button type="button" onClick={close}>Cancel</button><button type="button" class="sg-media-button--danger" autofocus onClick={() => { onConfirm(); close(); }}>{confirmLabel}</button></div></div>}
  </dialog>;
}
