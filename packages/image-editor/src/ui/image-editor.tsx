import { computed, For, getScope, Show, signal, type Child, type ReadonlySignal, type Ref } from '@takazudo/zfb/zudo-react';
import { fitAspectCrop, moveCropRect, orientedSize } from '../index';
import { CropOverlay } from './crop-overlay';
import { ResizePanel } from './resize-panel';
import { RotateControls } from './rotate-controls';
import { TonePanel } from './tone-panel';
import { createEditorState, documentError, withCrop } from './use-editor-state';
import type { EditorSessionProps, ImageEditorProps, ImageEditorSource, Tool } from './use-editor-state';
function isSourceSignal(source: ImageEditorProps['source']): source is ReadonlySignal<ImageEditorSource> {
  return typeof source === 'object' && source !== null && '$$zudoReactive' in source;
}
/** A source signal remounts the session per source identity, exactly as replacing the source used to reset it. */
export function ImageEditor(props: ImageEditorProps): Child {
  const source = props.source;
  if (!isSourceSignal(source)) return <EditorSession {...props} source={source} />;
  const ids = new WeakMap<object, number>();
  let nextId = 0;
  const identity = (value: ImageEditorSource) => { let id = ids.get(value); if (id === undefined) { id = ++nextId; ids.set(value, id); } return id; };
  const items = computed(() => [source.value]);
  return <For each={items} by={identity}>{item => <EditorSession {...props} source={item.value} />}</For>;
}
const TOOLS: readonly Tool[] = ['Crop', 'Rotate', 'Resize', 'Tone'];
const ASPECTS: readonly { value: string; label: string }[] = [
  { value: 'free', label: 'Free' }, { value: '1', label: '1:1' }, { value: String(16 / 9), label: '16:9' }, { value: String(4 / 3), label: '4:3' }, { value: String(1200 / 630), label: 'OGP 1200:630' },
];
function EditorSession(props: EditorSessionProps): Child {
  const scope = getScope();
  const editor = createEditorState(props);
  const stage: Ref<HTMLDivElement> = { current: null }, canvas: Ref<HTMLCanvasElement> = { current: null };
  let space = false;
  let pan: { id: number; x: number; y: number; startX: number; startY: number } | null = null;
  const bounds = signal({ width: 640, height: 400 });
  // The select's model: 'free' or the numeric ratio's string form.
  const aspectText = signal('free');
  const aspect = computed(() => aspectText.value === 'free' ? undefined : Number(aspectText.value));
  const oriented = computed(() => orientedSize(props.source, editor.doc.value.rotate));
  const displaySize = computed(() => editor.tool.value === 'Crop' ? oriented.value : editor.doc.value.resize);
  const view = editor.view;
  const imageStyle = computed(() => {
    const size = displaySize.value, box = bounds.value, v = view.value;
    const fit = Math.min((box.width - 48) / size.width, (box.height - 48) / size.height);
    const width = Math.max(1, size.width * fit), height = Math.max(1, size.height * fit);
    return { width: `${width}px`, height: `${height}px`, transform: `translate(-50%, -50%) translate(${v.x}px, ${v.y}px) scale(${v.zoom})` };
  });
  scope.onActivate(() => {
    const node = stage.current;
    if (!node) return;
    const measure = () => { const rect = node.getBoundingClientRect(); if (rect.width && rect.height) bounds.value = { width: rect.width, height: rect.height }; };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node); window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  });
  scope.effect(() => {
    const preview = editor.preview.value;
    const node = canvas.current;
    if (!node) return;
    if (!preview) { node.width = node.height = 0; return; }
    node.width = preview.width; node.height = preview.height;
    node.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height), 0, 0);
  });
  scope.onActivate(() => { const node = canvas.current; return () => { if (node) node.width = node.height = 0; }; });
  const rotation = computed(() => editor.doc.value.rotate);
  scope.effect(() => { void rotation.value; aspectText.value = 'free'; });
  function zoom(factor: number, clientX?: number, clientY?: number) {
    if (editor.isSaving()) return;
    const rect = stage.current!.getBoundingClientRect();
    const px = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2;
    const py = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2;
    editor.setView(old => { const next = Math.max(.25, Math.min(8, old.zoom * factor)); return { zoom: next, x: px - (px - old.x) * next / old.zoom, y: py - (py - old.y) * next / old.zoom }; });
  }
  function panDown(event: PointerEvent & { currentTarget: HTMLDivElement }) {
    if (editor.isSaving() || !(space && event.button === 0 || event.button === 1)) return;
    event.preventDefault();
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: view.value.x, startY: view.value.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function panEnd(event: PointerEvent & { currentTarget: HTMLDivElement }, cancel: boolean) {
    const start = pan;
    if (!start || start.id !== event.pointerId) return;
    pan = null;
    if (cancel) editor.setView(old => ({ ...old, x: start.startX, y: start.startY }));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editor.cancel(); return; }
    const target = event.target as HTMLElement;
    if (target.matches('input, textarea, select') || target.isContentEditable) return;
    if (event.code === 'Space' && stage.current?.contains(target)) { space = true; event.preventDefault(); }
    if (event.key.startsWith('Arrow') && editor.tool.value === 'Crop' && stage.current?.contains(target)) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const d = editor.current.current;
      const size = oriented.value;
      editor.update(withCrop(d, moveCropRect(d.crop, { x: (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) / size.width, y: (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) / size.height })));
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo(); }
  }
  function selectAspect(text: string) {
    aspectText.value = text;
    const next = text === 'free' ? undefined : Number(text);
    editor.setValidation(documentError(editor.current.current, props.source));
    if (next !== undefined) {
      try { editor.update(withCrop(editor.current.current, fitAspectCrop(oriented.value, next))); } catch (reason) { editor.setValidation(String(reason)); }
    }
  }
  const locked = computed(() => editor.saving.value || !editor.ready.value);
  const isTool = (tool: Tool) => computed(() => editor.tool.value === tool);
  const showCrop = computed(() => editor.tool.value === 'Crop' && editor.ready.value);
  const zoomText = computed(() => `${Math.round(view.value.zoom * 100)}%`);
  const outputText = computed(() => `${editor.doc.value.resize.width} × ${editor.doc.value.resize.height}`);
  const sourceText = computed(() => `Source: ${oriented.value.width} × ${oriented.value.height}`);
  const scaleText = computed(() => { const d = editor.doc.value, o = oriented.value; return `Scale: ${Math.round(d.resize.width / (o.width * d.crop.width) * 100)}% × ${Math.round(d.resize.height / (o.height * d.crop.height) * 100)}%`; });
  const statusText = computed(() => editor.saving.value ? 'Saving…' : editor.rendering.value ? 'Rendering preview…' : !editor.ready.value ? 'Loading image…' : 'Ready');
  const alertText = computed(() => editor.error.value || editor.validation.value);
  const hasAlert = computed(() => Boolean(alertText.value));
  const saveBlocked = computed(() => editor.saving.value || !editor.ready.value || !!editor.validation.value);
  const copyBlocked = computed(() => saveBlocked.value || props.canSaveCopy === false);
  return <section class="zie-editor" aria-label="Image editor" aria-busy={editor.saving} on:keydown={keyDown} on:keyup={e => { if (e.code === 'Space') space = false; }} on:blur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) space = false; }}>
    <fieldset class="zie-toolbar" disabled={locked} aria-label="Editing tools">
      {TOOLS.map(tool => <button type="button" aria-pressed={isTool(tool)} on:click={() => editor.setTool(tool)}>{tool}</button>)}
      <button type="button" disabled={computed(() => !editor.canUndo.value)} on:click={() => editor.undo()}>Undo</button><button type="button" disabled={computed(() => !editor.canRedo.value)} on:click={() => editor.redo()}>Redo</button><button type="button" on:click={() => { editor.reset(); aspectText.value = 'free'; }}>Reset</button>
    </fieldset>
    <div class="zie-body">
      <div class="zie-stage-column">
        <div class="zie-stage" ref={stage} tabindex={0} aria-label="Image preview; Space drag to pan" on:pointerdown={panDown} on:pointermove={e => { const start = pan; if (start?.id === e.pointerId && !editor.isSaving()) editor.setView(old => ({ ...old, x: start.startX + e.clientX - start.x, y: start.startY + e.clientY - start.y })); }} on:pointerup={e => panEnd(e, false)} on:pointercancel={e => panEnd(e, true)} on:lostpointercapture={e => panEnd(e, true)} on:wheel={e => { e.preventDefault(); if (editor.isSaving()) return; if (e.ctrlKey || e.metaKey) zoom(e.deltaY < 0 ? 1.25 : .8, e.clientX, e.clientY); else editor.setView(old => ({ ...old, x: old.x - e.deltaX, y: old.y - e.deltaY })); }}>
          <div class="zie-image" style={imageStyle}>
            <canvas ref={canvas} class="zie-canvas" aria-label="Edited image" />
            <Show when={showCrop}>{() => <CropOverlay editor={editor} size={oriented} aspect={aspect} panning={() => space} />}</Show>
          </div>
        </div>
        <div class="zie-row"><button type="button" disabled={editor.saving} on:click={() => zoom(.8)} aria-label="Zoom out">−</button><output aria-label="Zoom">{zoomText}</output><button type="button" disabled={editor.saving} on:click={() => zoom(1.25)} aria-label="Zoom in">+</button><button type="button" disabled={editor.saving} on:click={() => editor.setView({ zoom: 1, x: 0, y: 0 })}>Fit</button></div>
      </div>
      <fieldset class="zie-inspector" disabled={locked} aria-label={computed(() => `${editor.tool.value} settings`)}>
        <legend>{editor.tool}</legend>
        <Show when={isTool('Crop')}>{() => <div class="zie-controls"><label>Crop aspect<select aria-label="Crop aspect" modelValue={aspectText} on:change={e => selectAspect(e.currentTarget.value)}>{ASPECTS.map(option => <option value={option.value}>{option.label}</option>)}</select></label><p>Drag the selection to move it. Shift-drag keeps its aspect; Alt-drag resizes from center. Arrow keys move or resize by one source pixel; Shift uses ten.</p></div>}</Show>
        <Show when={isTool('Rotate')}>{() => <RotateControls editor={editor} />}</Show>
        <Show when={isTool('Resize')}>{() => <ResizePanel editor={editor} source={props.source} />}</Show>
        <Show when={isTool('Tone')}>{() => <TonePanel editor={editor} />}</Show>
        <p class="zie-dimensions"><output aria-label="Output dimensions">{outputText}</output><br />{sourceText}<br />{scaleText}</p>
      </fieldset>
    </div>
    <div class="zie-status" role="status">{statusText}</div>
    <Show when={hasAlert}>{() => <p class="zie-error" role="alert">{alertText}</p>}</Show>
    <footer class="zie-footer"><button type="button" disabled={saveBlocked} on:click={() => void editor.save('replace')}>Save</button><button type="button" disabled={copyBlocked} on:click={() => void editor.save('copy')}>Save as copy</button><button type="button" disabled={editor.saving} on:click={() => editor.cancel()}>Cancel</button></footer>
  </section>;
}
