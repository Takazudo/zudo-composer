import { useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { moveCropRect, resizeCropRect } from '../index';
import type { CropHandle, EditDoc, Size } from '../index';
import { withCrop } from './use-editor-state';
import type { EditorState } from './use-editor-state';
const handles: { handle: CropHandle; label: string; x: number; y: number }[] = [
  { handle: 'nw', label: 'top left', x: 0, y: 0 }, { handle: 'n', label: 'top', x: .5, y: 0 }, { handle: 'ne', label: 'top right', x: 1, y: 0 }, { handle: 'e', label: 'right', x: 1, y: .5 }, { handle: 'se', label: 'bottom right', x: 1, y: 1 }, { handle: 's', label: 'bottom', x: .5, y: 1 }, { handle: 'sw', label: 'bottom left', x: 0, y: 1 }, { handle: 'w', label: 'left', x: 0, y: .5 },
];
export function CropOverlay({ editor, size, aspect, panning }: { editor: EditorState; size: Size; aspect?: number; panning(): boolean }) {
  const overlay = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; width: number; height: number; doc: EditDoc; handle?: CropHandle } | null>(null);
  function down(event: JSX.TargetedPointerEvent<HTMLElement>, handle?: CropHandle) {
    if (editor.saving || event.button !== 0 || panning()) return;
    event.stopPropagation(); event.preventDefault();
    const box = overlay.current!.getBoundingClientRect();
    editor.begin(); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: box.width, height: box.height, doc: structuredClone(editor.current.current), handle };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: JSX.TargetedPointerEvent<HTMLElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    if (!editor.isGesturing()) { drag.current = null; return; }
    const delta = { x: (event.clientX - start.x) / start.width, y: (event.clientY - start.y) / start.height };
    try {
      const crop = start.handle ? resizeCropRect(start.doc.crop, start.handle, delta, size, { aspect: event.shiftKey ? start.doc.crop.width * size.width / (start.doc.crop.height * size.height) : aspect, fromCenter: event.altKey }) : moveCropRect(start.doc.crop, delta);
      editor.update(withCrop(start.doc, crop), false);
    } catch { /* A constrained ratio can be impossible at a boundary. Keep the last valid rect. */ }
  }
  function end(event: JSX.TargetedPointerEvent<HTMLElement>, cancel: boolean) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; editor.finish(cancel);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function key(event: JSX.TargetedKeyboardEvent<HTMLElement>, handle?: CropHandle) {
    if (!event.key.startsWith('Arrow') || editor.saving) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    const delta = { x: (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) / size.width, y: (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) / size.height };
    const d = editor.current.current;
    try { editor.update(withCrop(d, handle ? resizeCropRect(d.crop, handle, delta, size, { aspect, fromCenter: event.altKey }) : moveCropRect(d.crop, delta))); } catch { /* Keep valid geometry at constrained edges. */ }
  }
  const c = editor.doc.crop;
  const events = { onPointerMove: move, onPointerUp: (e: JSX.TargetedPointerEvent<HTMLElement>) => end(e, false), onPointerCancel: (e: JSX.TargetedPointerEvent<HTMLElement>) => end(e, true), onLostPointerCapture: (e: JSX.TargetedPointerEvent<HTMLElement>) => end(e, true) };
  return <div class="zie-crop-overlay" ref={overlay}>
    <div class="zie-crop-selection" role="group" tabIndex={editor.saving ? -1 : 0} aria-label="Move crop selection" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.width * 100}%`, height: `${c.height * 100}%` }} onPointerDown={e => down(e)} onKeyDown={e => key(e)} {...events}>
      {handles.map(h => <button type="button" class="zie-crop-handle" key={h.handle} disabled={editor.saving} aria-label={`Resize crop ${h.label}`} style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, transform: `translate(-50%, -50%) scale(${1 / editor.view.zoom})` }} onPointerDown={e => down(e, h.handle)} onKeyDown={e => key(e, h.handle)} {...events} />)}
    </div>
  </div>;
}
