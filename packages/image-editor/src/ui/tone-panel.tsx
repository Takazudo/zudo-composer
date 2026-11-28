import { computed, type Ref } from '@takazudo/zfb/zudo-react';
import type { Tone } from '../index';
import { syncInputValue } from './sync-value';
import type { EditorState } from './use-editor-state';
export function TonePanel({ editor }: { editor: EditorState }) {
  function change(key: keyof Tone, value: number, commit: boolean) {
    if (!Number.isFinite(value)) return;
    const max = key === 'hue' ? 180 : 100;
    const d = editor.current.current;
    editor.update({ ...d, tone: { ...d.tone, [key]: Math.max(-max, Math.min(max, value)) } }, commit);
  }
  const row = (key: keyof Tone) => {
    const range: Ref<HTMLInputElement> = { current: null };
    const number: Ref<HTMLInputElement> = { current: null };
    const value = computed(() => String(editor.doc.value.tone[key]));
    syncInputValue(range, value);
    syncInputValue(number, value);
    const min = key === 'hue' ? '-180' : '-100', max = key === 'hue' ? '180' : '100';
    return <div class="zie-tone">
      <label>{key}<input ref={range} aria-label={key} type="range" min={min} max={max} value={value.value} on:pointerdown={() => editor.begin()} on:input={e => { editor.begin(); change(key, Number(e.currentTarget.value), false); }} on:change={() => editor.finish()} on:pointerup={() => editor.finish()} on:pointercancel={() => editor.finish(true)} on:blur={() => editor.finish()} /></label>
      <input ref={number} aria-label={`${key} value`} type="number" min={min} max={max} value={value.value} on:change={e => change(key, e.currentTarget.valueAsNumber, true)} />
      <button type="button" on:click={() => change(key, 0, true)}>Reset {key}</button>
    </div>;
  };
  return <div class="zie-controls">{(['brightness', 'contrast', 'saturation', 'hue'] as const).map(row)}</div>;
}
