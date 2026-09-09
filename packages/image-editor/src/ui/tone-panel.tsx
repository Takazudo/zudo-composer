import type { Tone } from '../index';
import type { EditorState } from './use-editor-state';
export function TonePanel({ editor }: { editor: EditorState }) {
  function change(key: keyof Tone, value: number, commit: boolean) {
    if (!Number.isFinite(value)) return;
    const max = key === 'hue' ? 180 : 100;
    const d = editor.current.current;
    editor.update({ ...d, tone: { ...d.tone, [key]: Math.max(-max, Math.min(max, value)) } }, commit);
  }
  return <div class="zie-controls">{(['brightness', 'contrast', 'saturation', 'hue'] as const).map(key => <div class="zie-tone" key={key}>
    <label>{key}<input aria-label={key} type="range" min={key === 'hue' ? -180 : -100} max={key === 'hue' ? 180 : 100} value={editor.doc.tone[key]} onPointerDown={() => editor.begin()} onInput={e => { editor.begin(); change(key, Number(e.currentTarget.value), false); }} onChange={() => editor.finish()} onPointerUp={() => editor.finish()} onPointerCancel={() => editor.finish(true)} onBlur={() => editor.finish()} /></label>
    <input aria-label={`${key} value`} type="number" min={key === 'hue' ? -180 : -100} max={key === 'hue' ? 180 : 100} value={editor.doc.tone[key]} onChange={e => change(key, e.currentTarget.valueAsNumber, true)} />
    <button type="button" onClick={() => change(key, 0, true)}>Reset {key}</button>
  </div>)}</div>;
}
