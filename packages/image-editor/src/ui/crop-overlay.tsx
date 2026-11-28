import { computed, type ReadonlySignal, type Ref } from '@takazudo/zfb/zudo-react';
import { moveCropRect, resizeCropRect } from '../index';
import type { CropHandle, EditDoc, Size } from '../index';
import { withCrop } from './use-editor-state';
import type { EditorState } from './use-editor-state';
const handles: { handle: CropHandle; label: string; x: number; y: number }[] = [
  { handle: 'nw', label: 'top left', x: 0, y: 0 }, { handle: 'n', label: 'top', x: .5, y: 0 }, { handle: 'ne', label: 'top right', x: 1, y: 0 }, { handle: 'e', label: 'right', x: 1, y: .5 }, { handle: 'se', label: 'bottom right', x: 1, y: 1 }, { handle: 's', label: 'bottom', x: .5, y: 1 }, { handle: 'sw', label: 'bottom left', x: 0, y: 1 }, { handle: 'w', label: 'left', x: 0, y: .5 },
];
type HandlePointerEvent = PointerEvent & { currentTarget: HTMLElement };
type HandleKeyboardEvent = KeyboardEvent & { currentTarget: HTMLElement };
export interface CropOverlayProps { editor: EditorState; size: ReadonlySignal<Size>; aspect: ReadonlySignal<number | undefined>; panning(): boolean }
export function CropOverlay({ editor, size, aspect, panning }: CropOverlayProps) {
  const overlay: Ref<HTMLDivElement> = { current: null };
  let drag: { id: number; x: number; y: number; width: number; height: number; doc: EditDoc; handle?: CropHandle } | null = null;
  function down(event: HandlePointerEvent, handle?: CropHandle) {
    if (editor.isSaving() || event.button !== 0 || panning()) return;
    event.stopPropagation(); event.preventDefault();
    const box = overlay.current!.getBoundingClientRect();
    editor.begin(); drag = { id: event.pointerId, x: event.clientX, y: event.clientY, width: box.width, height: box.height, doc: structuredClone(editor.current.current), handle };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: HandlePointerEvent) {
    const start = drag;
    if (!start || start.id !== event.pointerId) return;
    if (!editor.isGesturing()) { drag = null; return; }
    const delta = { x: (event.clientX - start.x) / start.width, y: (event.clientY - start.y) / start.height };
    const bounds = size.value;
    try {
      const crop = start.handle ? resizeCropRect(start.doc.crop, start.handle, delta, bounds, { aspect: event.shiftKey ? start.doc.crop.width * bounds.width / (start.doc.crop.height * bounds.height) : aspect.value, fromCenter: event.altKey }) : moveCropRect(start.doc.crop, delta);
      editor.update(withCrop(start.doc, crop), false);
    } catch { /* A constrained ratio can be impossible at a boundary. Keep the last valid rect. */ }
  }
  function end(event: HandlePointerEvent, cancel: boolean) {
    if (drag?.id !== event.pointerId) return;
    drag = null; editor.finish(cancel);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function key(event: HandleKeyboardEvent, handle?: CropHandle) {
    if (!event.key.startsWith('Arrow') || editor.isSaving()) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    const bounds = size.value;
    const delta = { x: (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) / bounds.width, y: (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) / bounds.height };
    const d = editor.current.current;
    try { editor.update(withCrop(d, handle ? resizeCropRect(d.crop, handle, delta, bounds, { aspect: aspect.value, fromCenter: event.altKey }) : moveCropRect(d.crop, delta))); } catch { /* Keep valid geometry at constrained edges. */ }
  }
  const events = {
    'on:pointermove': move,
    'on:pointerup': (e: HandlePointerEvent) => end(e, false),
    'on:pointercancel': (e: HandlePointerEvent) => end(e, true),
    'on:lostpointercapture': (e: HandlePointerEvent) => end(e, true),
  };
  const selectionStyle = computed(() => { const c = editor.doc.value.crop; return { left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.width * 100}%`, height: `${c.height * 100}%` }; });
  const tabindex = computed(() => editor.saving.value ? -1 : 0);
  return <div class="zie-crop-overlay" ref={overlay}>
    <div class="zie-crop-selection" role="group" tabindex={tabindex} aria-label="Move crop selection" style={selectionStyle} on:pointerdown={e => down(e)} on:keydown={e => key(e)} {...events}>
      {handles.map(h => <button type="button" class="zie-crop-handle" disabled={editor.saving} aria-label={`Resize crop ${h.label}`} style={computed(() => ({ left: `${h.x * 100}%`, top: `${h.y * 100}%`, transform: `translate(-50%, -50%) scale(${1 / editor.view.value.zoom})` }))} on:pointerdown={e => down(e, h.handle)} on:keydown={e => key(e, h.handle)} {...events} />)}
    </div>
  </div>;
}
