import { computed, getScope, signal, type ReadonlySignal } from '@takazudo/zfb/zudo-react';
import { createEditDoc, createHistory, encode, guardWorkingSet, MAX_ENCODED_BYTES, orientedSize, validateEditDoc, validateSize } from '../index';
import type { EditDoc, EditableMime, Rect, RgbaImage, Size } from '../index';
import { createImageEditorClient } from '../worker/client';
export type Tool = 'Crop' | 'Rotate' | 'Resize' | 'Tone';
export type ImageEditorSource = ImageBitmap | ImageData;
export interface ImageEditorProps {
  /** A signal source remounts the editor (fresh worker, history and view) when it changes identity. */
  source: ImageEditorSource | ReadonlySignal<ImageEditorSource>;
  mimeType: EditableMime;
  onSave(blob: Blob, mode: 'replace' | 'copy'): Promise<void>;
  onCancel(): void;
  canSaveCopy?: boolean;
  /** Host uses this to gate modal close/backdrop for render, encode, and persistence. */
  onSavingChange?(saving: boolean): void;
}
/** One editing session: the props of a single mounted source. */
export type EditorSessionProps = Omit<ImageEditorProps, 'source'> & { source: ImageEditorSource };
export interface EditorView { zoom: number; x: number; y: number }
export function documentError(doc: EditDoc, size: Size, maxEdge?: number): string {
  try {
    validateEditDoc(doc, size);
    const oriented = orientedSize(size, doc.rotate);
    const cropPixels = Math.min(oriented.width, Math.ceil((doc.crop.x + doc.crop.width) * oriented.width)) - Math.floor(doc.crop.x * oriented.width);
    const cropRows = Math.min(oriented.height, Math.ceil((doc.crop.y + doc.crop.height) * oriented.height)) - Math.floor(doc.crop.y * oriented.height);
    const scale = maxEdge ? Math.min(1, maxEdge / Math.max(doc.resize.width, doc.resize.height)) : 1;
    const outputWidth = Math.max(1, Math.round(doc.resize.width * scale));
    const outputHeight = Math.max(1, Math.round(doc.resize.height * scale));
    guardWorkingSet(size.width * size.height * 8, cropPixels * cropRows * 12, outputWidth * outputHeight * 12, Math.max(outputWidth, cropPixels) * 256, 1024 * 1024 * 8);
    if (!maxEdge) guardWorkingSet(size.width * size.height * 8, doc.resize.width * doc.resize.height * 16, 1024 * 1024 * 8);
    return '';
  } catch (error) { return `${String(error)}. Choose smaller, positive integer dimensions (maximum 40 MP).`; }
}
export function withCrop(doc: EditDoc, crop: Rect): EditDoc {
  return { ...doc, crop, resize: { width: Math.max(1, Math.round(doc.resize.width * crop.width / doc.crop.width)), height: Math.max(1, Math.round(doc.resize.height * crop.height / doc.crop.height)) } };
}
function readSource(source: ImageEditorSource): RgbaImage {
  // Account for the caller bitmap, canvas, RGBA readback, and worker copy before conversion.
  guardWorkingSet(validateSize(source) * ('data' in source ? 8 : 16), 1024 * 1024 * 8);
  if ('data' in source) return { width: source.width, height: source.height, data: source.data };
  const canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Cannot read image');
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, source.width, source.height);
    return { width: pixels.width, height: pixels.height, data: pixels.data };
  } finally { canvas.width = canvas.height = 0; }
}
/**
 * The editing session for one source. Call it once in a component's setup:
 * the worker client is created on activation and disposed with the scope, so a
 * new source means a new session (the editor remounts per source identity).
 */
export function createEditorState(props: EditorSessionProps) {
  const scope = getScope();
  const source = props.source;
  const initial = createEditDoc(source);
  const doc = signal(initial);
  const current = { current: initial };
  const history = createHistory(initial);
  // Bumped on every history move, so `canUndo`/`canRedo` follow the history object.
  const historyRevision = signal(0);
  let gesture: EditDoc | null = null;
  const tool = signal<Tool>('Crop');
  let toolNow: Tool = 'Crop';
  const ready = signal(false);
  let registered = false;
  const rendering = signal(false);
  const saving = signal(false);
  let savingNow = false;
  const error = signal('');
  const validation = signal(documentError(initial, source));
  const preview = signal<RgbaImage | null>(null);
  let client: ReturnType<typeof createImageEditorClient> | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  let cancelled = false;
  const view = signal<EditorView>({ zoom: 1, x: 0, y: 0 });
  function invalidate() { generation++; clearTimeout(timer); }
  function schedule(next: EditDoc) {
    invalidate();
    if (!client || !registered || savingNow) return;
    const gen = generation;
    const service = client;
    const cropMode = toolNow === 'Crop';
    const renderDoc = cropMode ? { ...next, crop: { x: 0, y: 0, width: 1, height: 1 }, resize: orientedSize(source, next.rotate) } : next;
    if (documentError(renderDoc, source, 1024)) { rendering.value = false; return; }
    rendering.value = true;
    timer = setTimeout(() => {
      void service.renderPreview(renderDoc).then(result => {
        if (alive && gen === generation) { preview.value = result; rendering.value = false; }
      }).catch(reason => {
        if (alive && gen === generation) { error.value = error.value || String(reason); rendering.value = false; }
      });
    }, 120);
  }
  function update(next: EditDoc, commit = true) {
    if (savingNow) return;
    current.current = next;
    if (commit) { history.commit(next); gesture = null; }
    historyRevision.value++;
    doc.value = next; error.value = ''; validation.value = documentError(next, source); schedule(next);
  }
  function begin() { if (!savingNow && !gesture) gesture = structuredClone(current.current); }
  function finish(cancel = false) {
    if (!gesture || savingNow) return;
    const start = gesture; gesture = null;
    update(cancel ? start : current.current, !cancel);
  }
  function setTool(next: Tool) { if (savingNow) return; finish(); if ((next === 'Crop') !== (toolNow === 'Crop')) preview.value = null; toolNow = next; tool.value = next; schedule(current.current); }
  function undo() { if (!savingNow) { gesture = null; update(history.undo(), false); } }
  function redo() { if (!savingNow) { gesture = null; update(history.redo(), false); } }
  function cancel() { if (!savingNow && !cancelled) { cancelled = true; props.onCancel(); } }
  async function save(mode: 'replace' | 'copy') {
    if (savingNow || !ready.value || validation.value || (mode === 'copy' && props.canSaveCopy === false)) return;
    finish();
    const snapshot = structuredClone(current.current);
    const invalid = documentError(snapshot, source);
    if (invalid) { validation.value = invalid; return; }
    const service = client;
    if (!service) return;
    savingNow = true; saving.value = true; props.onSavingChange?.(true); error.value = ''; invalidate(); rendering.value = false;
    const gen = generation;
    try {
      const image = await service.renderFull(snapshot);
      if (!alive || gen !== generation) return;
      const blob = await encode(image, { type: props.mimeType, quality: props.mimeType === 'image/png' ? undefined : 0.9 });
      if (!alive || gen !== generation) return;
      if (blob.type !== props.mimeType) throw new Error('Encoder did not preserve the source MIME');
      if (blob.size > MAX_ENCODED_BYTES) throw new Error('Output exceeds 25 MiB. Choose smaller dimensions.');
      await props.onSave(blob, mode);
    } catch (reason) {
      if (alive && gen === generation) error.value = `${String(reason)}. Edits are preserved; try smaller dimensions if the output is too large.`;
    } finally {
      if (alive && gen === generation) { savingNow = false; saving.value = false; props.onSavingChange?.(false); schedule(current.current); }
    }
  }
  scope.onActivate(() => {
    const service = createImageEditorClient(); client = service;
    let active = true;
    try {
      void service.registerSource(readSource(source)).then(() => { if (active) { registered = true; ready.value = true; schedule(current.current); } }).catch(reason => { if (active) error.value = String(reason); });
    } catch (reason) { error.value = String(reason); }
    return () => { active = false; registered = false; alive = false; invalidate(); client = null; service.dispose(); };
  });
  const canUndo = computed(() => { void historyRevision.value; return history.canUndo; });
  const canRedo = computed(() => { void historyRevision.value; return history.canRedo; });
  return {
    source, doc, current, tool, setTool, ready, rendering, saving, isSaving: () => savingNow, error, validation, preview, view,
    setView: (next: EditorView | ((old: EditorView) => EditorView)) => { view.value = typeof next === 'function' ? next(view.value) : next; },
    update, begin, finish, isGesturing: () => gesture !== null, undo, redo, cancel, save,
    reset: () => update(history.baseline), canUndo, canRedo,
    setValidation: (message: string) => { validation.value = message; },
  };
}
export type EditorState = ReturnType<typeof createEditorState>;
