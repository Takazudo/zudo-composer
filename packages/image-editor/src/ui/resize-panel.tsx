import { computed, getScope, Show, signal, type Ref } from '@takazudo/zfb/zudo-react';
import { orientedSize } from '../index';
import type { Size } from '../index';
import { syncInputValue } from './sync-value';
import { documentError } from './use-editor-state';
import type { EditorState } from './use-editor-state';
type Draft = { width?: string; height?: string };
export function ResizePanel({ editor, source }: { editor: EditorState; source: Size }) {
  const scope = getScope();
  const locked = signal(true);
  const ratio = () => editor.doc.value.resize.width / editor.doc.value.resize.height;
  let lockedRatio = ratio();
  const crop = computed(() => editor.doc.value.crop);
  const rotate = computed(() => editor.doc.value.rotate);
  scope.effect(() => { void crop.value; void rotate.value; lockedRatio = ratio(); });
  const draft = signal<Draft>({});
  let draftNow: Draft = {};
  const setDraft = (next: Draft) => { draftNow = next; draft.value = next; };
  scope.effect(() => { void editor.doc.value; setDraft({}); });
  function resize(axis: 'width' | 'height', text: string) {
    const nextDraft = { ...draftNow, [axis]: text };
    setDraft(nextDraft);
    const d = editor.current.current, value = Number(text);
    const other = axis === 'width' ? 'height' : 'width';
    const size = { width: Number(nextDraft.width ?? d.resize.width), height: Number(nextDraft.height ?? d.resize.height), [axis]: value, ...(locked.value ? { [other]: Math.max(1, Math.round(axis === 'width' ? value / lockedRatio : value * lockedRatio)) } : {}) };
    const invalid = documentError({ ...d, resize: size }, source);
    editor.setValidation(invalid);
    if (!invalid) { editor.update({ ...d, resize: size }); setDraft({}); }
  }
  function preset(scale: number) {
    const d = editor.current.current;
    const size = orientedSize(source, d.rotate);
    const resize = { width: Math.max(1, Math.round(size.width * d.crop.width * scale)), height: Math.max(1, Math.round(size.height * d.crop.height * scale)) };
    const invalid = documentError({ ...d, resize }, source);
    editor.setValidation(invalid);
    if (invalid) setDraft({ width: String(resize.width), height: String(resize.height) });
    else { setDraft({}); editor.update({ ...d, resize }); }
  }
  const field = (axis: 'width' | 'height') => {
    const input: Ref<HTMLInputElement> = { current: null };
    const display = computed(() => draft.value[axis] ?? String(editor.doc.value.resize[axis]));
    syncInputValue(input, display);
    return <label>Output {axis}<input ref={input} aria-label={`Output ${axis}`} type="number" min="1" step="1" value={display.value} on:input={e => resize(axis, e.currentTarget.value)} /></label>;
  };
  const requested = computed(() => draft.value.width !== undefined || draft.value.height !== undefined);
  const requestedText = computed(() => `Requested output: ${draft.value.width ?? editor.doc.value.resize.width} × ${draft.value.height ?? editor.doc.value.resize.height}`);
  return <div class="zie-controls">
    {field('width')}{field('height')}
    <label><input type="checkbox" modelChecked={locked} on:change={e => { locked.value = e.currentTarget.checked; lockedRatio = ratio(); }} />Lock aspect ratio</label>
    <div class="zie-row">{[0.5, 1, 2].map(scale => <button type="button" on:click={() => preset(scale)}>{scale * 100}%</button>)}</div>
    <Show when={requested}>{() => <p>{requestedText}</p>}</Show>
    <p>Resampling does not create new detail. ML upscaling is not available in this editor.</p>
  </div>;
}
