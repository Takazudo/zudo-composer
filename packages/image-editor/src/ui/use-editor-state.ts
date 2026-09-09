import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createEditDoc, createHistory, encode, guardWorkingSet, MAX_ENCODED_BYTES, orientedSize, validateEditDoc, validateSize } from '../index';
import type { EditDoc, EditableMime, Rect, RgbaImage, Size } from '../index';
import { createImageEditorClient } from '../worker/client';
export type Tool = 'Crop' | 'Rotate' | 'Resize' | 'Tone';
export interface ImageEditorProps {
  source: ImageBitmap | ImageData;
  mimeType: EditableMime;
  onSave(blob: Blob, mode: 'replace' | 'copy'): Promise<void>;
  onCancel(): void;
  canSaveCopy?: boolean;
  /** Host uses this to gate modal close/backdrop for render, encode, and persistence. */
  onSavingChange?(saving: boolean): void;
}
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
function readSource(source: ImageBitmap | ImageData): RgbaImage {
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
export function useEditorState(props: ImageEditorProps) {
  const [doc, setDoc] = useState(() => createEditDoc(props.source));
  const current = useRef(doc);
  const history = useRef(createHistory(doc));
  const gesture = useRef<EditDoc | null>(null);
  const [tool, setToolState] = useState<Tool>('Crop');
  const toolRef = useRef(tool);
  const [ready, setReady] = useState(false);
  const registered = useRef(false);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const [validation, setValidation] = useState('');
  const [preview, setPreview] = useState<RgbaImage | null>(null);
  const client = useRef<ReturnType<typeof createImageEditorClient> | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const cancelled = useRef(false);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  function invalidate() { generation.current++; clearTimeout(timer.current); }
  function schedule(next: EditDoc) {
    invalidate();
    if (!client.current || !registered.current || savingRef.current) return;
    const gen = generation.current;
    const service = client.current;
    const cropMode = toolRef.current === 'Crop';
    const renderDoc = cropMode ? { ...next, crop: { x: 0, y: 0, width: 1, height: 1 }, resize: orientedSize(props.source, next.rotate) } : next;
    if (documentError(renderDoc, props.source, 1024)) { setRendering(false); return; }
    setRendering(true);
    timer.current = setTimeout(() => {
      void service.renderPreview(renderDoc).then(result => {
        if (alive.current && gen === generation.current) { setPreview(result); setRendering(false); }
      }).catch(reason => {
        if (alive.current && gen === generation.current) { setError(previous => previous || String(reason)); setRendering(false); }
      });
    }, 120);
  }
  function update(next: EditDoc, commit = true) {
    if (savingRef.current) return;
    current.current = next;
    if (commit) { history.current.commit(next); gesture.current = null; }
    setDoc(next); setError(''); setValidation(documentError(next, props.source)); schedule(next);
  }
  function begin() { if (!savingRef.current && !gesture.current) gesture.current = structuredClone(current.current); }
  function finish(cancel = false) {
    if (!gesture.current || savingRef.current) return;
    const start = gesture.current; gesture.current = null;
    update(cancel ? start : current.current, !cancel);
  }
  function setTool(next: Tool) { if (savingRef.current) return; finish(); if ((next === 'Crop') !== (toolRef.current === 'Crop')) setPreview(null); toolRef.current = next; setToolState(next); schedule(current.current); }
  function undo() { if (!savingRef.current) { gesture.current = null; update(history.current.undo(), false); } }
  function redo() { if (!savingRef.current) { gesture.current = null; update(history.current.redo(), false); } }
  function cancel() { if (!savingRef.current && !cancelled.current) { cancelled.current = true; props.onCancel(); } }
  async function save(mode: 'replace' | 'copy') {
    if (savingRef.current || !ready || validation || (mode === 'copy' && props.canSaveCopy === false)) return;
    finish();
    const snapshot = structuredClone(current.current);
    const invalid = documentError(snapshot, props.source);
    if (invalid) { setValidation(invalid); return; }
    const service = client.current;
    if (!service) return;
    savingRef.current = true; setSaving(true); props.onSavingChange?.(true); setError(''); invalidate(); setRendering(false);
    const gen = generation.current;
    try {
      const image = await service.renderFull(snapshot);
      if (!alive.current || gen !== generation.current) return;
      const blob = await encode(image, { type: props.mimeType, quality: props.mimeType === 'image/png' ? undefined : 0.9 });
      if (!alive.current || gen !== generation.current) return;
      if (blob.type !== props.mimeType) throw new Error('Encoder did not preserve the source MIME');
      if (blob.size > MAX_ENCODED_BYTES) throw new Error('Output exceeds 25 MiB. Choose smaller dimensions.');
      await props.onSave(blob, mode);
    } catch (reason) {
      if (alive.current && gen === generation.current) setError(`${String(reason)}. Edits are preserved; try smaller dimensions if the output is too large.`);
    } finally {
      if (alive.current && gen === generation.current) { savingRef.current = false; setSaving(false); props.onSavingChange?.(false); schedule(current.current); }
    }
  }
  useLayoutEffect(() => {
    registered.current = false;
    alive.current = true; cancelled.current = false; invalidate();
    const service = createImageEditorClient(); client.current = service;
    const initial = createEditDoc(props.source); history.current = createHistory(initial); gesture.current = null;
    current.current = initial; setDoc(initial); setReady(false); setPreview(null); setError(''); setValidation(documentError(initial, props.source));
    savingRef.current = false; setSaving(false); setView({ zoom: 1, x: 0, y: 0 });
    let active = true;
    try {
      void service.registerSource(readSource(props.source)).then(() => { if (active) { registered.current = true; setReady(true); schedule(current.current); } }).catch(reason => { if (active) setError(String(reason)); });
    } catch (reason) { setError(String(reason)); }
    return () => { active = false; registered.current = false; alive.current = false; invalidate(); client.current = null; service.dispose(); };
  }, [props.source]);
  return { doc, current, tool, setTool, ready, rendering, saving, error, validation, preview, view, setView, update, begin, finish, isGesturing: () => gesture.current !== null, undo, redo, cancel, save, reset: () => update(history.current.baseline), canUndo: history.current.canUndo, canRedo: history.current.canRedo, setValidation };
}
export type EditorState = ReturnType<typeof useEditorState>;
