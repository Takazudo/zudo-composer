import { useEffect, useState } from 'preact/hooks';
import { orientedSize } from '../index';
import type { Size } from '../index';
import { documentError } from './use-editor-state';
import type { EditorState } from './use-editor-state';
export function ResizePanel({ editor, source }: { editor: EditorState; source: Size }) {
  const [locked, setLocked] = useState(true);
  const [lockedRatio, setLockedRatio] = useState(editor.doc.resize.width / editor.doc.resize.height);
  useEffect(() => { setLockedRatio(editor.doc.resize.width / editor.doc.resize.height); }, [editor.doc.crop, editor.doc.rotate]);
  const [draft, setDraft] = useState<{ width?: string; height?: string }>({});
  useEffect(() => { setDraft({}); }, [editor.doc]);
  function resize(axis: 'width' | 'height', text: string) {
    const nextDraft = { ...draft, [axis]: text };
    setDraft(nextDraft);
    const d = editor.current.current, value = Number(text);
    const other = axis === 'width' ? 'height' : 'width';
    const size = { width: Number(nextDraft.width ?? d.resize.width), height: Number(nextDraft.height ?? d.resize.height), [axis]: value, ...(locked ? { [other]: Math.max(1, Math.round(axis === 'width' ? value / lockedRatio : value * lockedRatio)) } : {}) };
    const invalid = documentError({ ...d, resize: size }, source);
    editor.setValidation(invalid);
    if (!invalid) { editor.update({ ...d, resize: size }); setDraft({}); }
  }
  const size = orientedSize(source, editor.doc.rotate);
  function preset(scale: number) {
    const d = editor.current.current;
    const resize = { width: Math.max(1, Math.round(size.width * d.crop.width * scale)), height: Math.max(1, Math.round(size.height * d.crop.height * scale)) };
    const invalid = documentError({ ...d, resize }, source);
    editor.setValidation(invalid);
    if (invalid) setDraft({ width: String(resize.width), height: String(resize.height) });
    else { setDraft({}); editor.update({ ...d, resize }); }
  }
  return <div class="zie-controls">
    {(['width', 'height'] as const).map(axis => <label key={axis}>Output {axis}<input aria-label={`Output ${axis}`} type="number" min="1" step="1" value={draft[axis] ?? editor.doc.resize[axis]} onInput={e => resize(axis, e.currentTarget.value)} /></label>)}
    <label><input type="checkbox" checked={locked} onChange={e => { setLocked(e.currentTarget.checked); setLockedRatio(editor.doc.resize.width / editor.doc.resize.height); }} />Lock aspect ratio</label>
    <div class="zie-row">{[0.5, 1, 2].map(scale => <button type="button" key={scale} onClick={() => preset(scale)}>{scale * 100}%</button>)}</div>
    {(draft.width !== undefined || draft.height !== undefined) && <p>Requested output: {draft.width ?? editor.doc.resize.width} × {draft.height ?? editor.doc.resize.height}</p>}
    <p>Normal resampling does not create new detail. ML upscaling is planned separately.</p>
  </div>;
}
