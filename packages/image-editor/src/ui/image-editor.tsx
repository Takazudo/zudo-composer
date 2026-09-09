import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { fitAspectCrop, moveCropRect, orientedSize } from '../index';
import { CropOverlay } from './crop-overlay';
import { ResizePanel } from './resize-panel';
import { RotateControls } from './rotate-controls';
import { TonePanel } from './tone-panel';
import { documentError, useEditorState, withCrop } from './use-editor-state';
import type { ImageEditorProps, Tool } from './use-editor-state';
export function ImageEditor(props: ImageEditorProps) {
  const editor = useEditorState(props);
  const stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const space = useRef(false);
  const pan = useRef<{ id: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const [bounds, setBounds] = useState({ width: 640, height: 400 });
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const oriented = orientedSize(props.source, editor.doc.rotate);
  const displaySize = editor.tool === 'Crop' ? oriented : editor.doc.resize;
  const fit = Math.min((bounds.width - 48) / displaySize.width, (bounds.height - 48) / displaySize.height);
  const width = Math.max(1, displaySize.width * fit), height = Math.max(1, displaySize.height * fit);
  const { view } = editor;
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const measure = () => { const rect = node.getBoundingClientRect(); if (rect.width && rect.height) setBounds({ width: rect.width, height: rect.height }); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node); window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useLayoutEffect(() => {
    const node = canvas.current, preview = editor.preview;
    if (!node) return;
    if (!preview) { node.width = node.height = 0; return; }
    node.width = preview.width; node.height = preview.height;
    node.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height), 0, 0);
  }, [editor.preview]);
  useLayoutEffect(() => { const node = canvas.current; return () => { if (node) node.width = node.height = 0; }; }, []);
  useEffect(() => { setAspect(undefined); }, [props.source, editor.doc.rotate]);
  function zoom(factor: number, clientX?: number, clientY?: number) {
    if (editor.saving) return;
    const rect = stage.current!.getBoundingClientRect();
    const px = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2;
    const py = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2;
    editor.setView(old => { const next = Math.max(.25, Math.min(8, old.zoom * factor)); return { zoom: next, x: px - (px - old.x) * next / old.zoom, y: py - (py - old.y) * next / old.zoom }; });
  }
  function panDown(event: JSX.TargetedPointerEvent<HTMLDivElement>) {
    if (editor.saving || !(space.current && event.button === 0 || event.button === 1)) return;
    event.preventDefault();
    pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: view.x, startY: view.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function panEnd(event: JSX.TargetedPointerEvent<HTMLDivElement>, cancel: boolean) {
    const start = pan.current;
    if (!start || start.id !== event.pointerId) return;
    pan.current = null;
    if (cancel) editor.setView(old => ({ ...old, x: start.startX, y: start.startY }));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyDown(event: JSX.TargetedKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editor.cancel(); return; }
    const target = event.target as HTMLElement;
    if (target.matches('input, textarea, select') || target.isContentEditable) return;
    if (event.code === 'Space' && stage.current?.contains(target)) { space.current = true; event.preventDefault(); }
    if (event.key.startsWith('Arrow') && editor.tool === 'Crop' && stage.current?.contains(target)) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const d = editor.current.current;
      editor.update(withCrop(d, moveCropRect(d.crop, { x: (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) / oriented.width, y: (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) / oriented.height })));
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo(); }
  }
  function selectAspect(text: string) {
    const next = text === 'free' ? undefined : Number(text); setAspect(next);
    editor.setValidation(documentError(editor.current.current, props.source));
    if (next !== undefined) {
      try { editor.update(withCrop(editor.current.current, fitAspectCrop(oriented, next))); } catch (reason) { editor.setValidation(String(reason)); }
    }
  }
  return <section class="zie-editor" aria-label="Image editor" aria-busy={editor.saving} onKeyDown={keyDown} onKeyUp={e => { if (e.code === 'Space') space.current = false; }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) space.current = false; }}>
    <fieldset class="zie-toolbar" disabled={editor.saving || !editor.ready} aria-label="Editing tools">
      {(['Crop', 'Rotate', 'Resize', 'Tone'] as Tool[]).map(tool => <button type="button" key={tool} aria-pressed={tool === editor.tool} onClick={() => editor.setTool(tool)}>{tool}</button>)}
      <button type="button" disabled={!editor.canUndo} onClick={editor.undo}>Undo</button><button type="button" disabled={!editor.canRedo} onClick={editor.redo}>Redo</button><button type="button" onClick={() => { editor.reset(); setAspect(undefined); }}>Reset</button>
    </fieldset>
    <div class="zie-body">
      <div class="zie-stage-column">
        <div class="zie-stage" ref={stage} tabIndex={0} aria-label="Image preview; Space drag to pan" onPointerDown={panDown} onPointerMove={e => { const start = pan.current; if (start?.id === e.pointerId && !editor.saving) editor.setView(old => ({ ...old, x: start.startX + e.clientX - start.x, y: start.startY + e.clientY - start.y })); }} onPointerUp={e => panEnd(e, false)} onPointerCancel={e => panEnd(e, true)} onLostPointerCapture={e => panEnd(e, true)} onWheel={e => { e.preventDefault(); if (editor.saving) return; if (e.ctrlKey || e.metaKey) zoom(e.deltaY < 0 ? 1.25 : .8, e.clientX, e.clientY); else editor.setView(old => ({ ...old, x: old.x - e.deltaX, y: old.y - e.deltaY })); }}>
          <div class="zie-image" style={{ width, height, transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            <canvas ref={canvas} class="zie-canvas" aria-label="Edited image" />
            {editor.tool === 'Crop' && editor.ready && <CropOverlay editor={editor} size={oriented} aspect={aspect} panning={() => space.current} />}
          </div>
        </div>
        <div class="zie-row"><button type="button" disabled={editor.saving} onClick={() => zoom(.8)} aria-label="Zoom out">−</button><output aria-label="Zoom">{Math.round(view.zoom * 100)}%</output><button type="button" disabled={editor.saving} onClick={() => zoom(1.25)} aria-label="Zoom in">+</button><button type="button" disabled={editor.saving} onClick={() => editor.setView({ zoom: 1, x: 0, y: 0 })}>Fit</button></div>
      </div>
      <fieldset class="zie-inspector" disabled={editor.saving || !editor.ready} aria-label={`${editor.tool} settings`}>
        <legend>{editor.tool}</legend>
        {editor.tool === 'Crop' && <div class="zie-controls"><label>Crop aspect<select aria-label="Crop aspect" value={aspect ?? 'free'} onChange={e => selectAspect(e.currentTarget.value)}><option value="free">Free</option><option value="1">1:1</option><option value={16 / 9}>16:9</option><option value={4 / 3}>4:3</option><option value={1200 / 630}>OGP 1200:630</option></select></label><p>Drag the selection to move it. Shift-drag keeps its aspect; Alt-drag resizes from center. Arrow keys move or resize by one source pixel; Shift uses ten.</p></div>}
        {editor.tool === 'Rotate' && <RotateControls editor={editor} />}
        {editor.tool === 'Resize' && <ResizePanel editor={editor} source={props.source} />}
        {editor.tool === 'Tone' && <TonePanel editor={editor} />}
        <p class="zie-dimensions"><output aria-label="Output dimensions">{editor.doc.resize.width} × {editor.doc.resize.height}</output><br />Source: {oriented.width} × {oriented.height}<br />Scale: {Math.round(editor.doc.resize.width / (oriented.width * editor.doc.crop.width) * 100)}% × {Math.round(editor.doc.resize.height / (oriented.height * editor.doc.crop.height) * 100)}%</p>
      </fieldset>
    </div>
    <div class="zie-status" role="status">{editor.saving ? 'Saving…' : editor.rendering ? 'Rendering preview…' : !editor.ready ? 'Loading image…' : 'Ready'}</div>
    {(editor.error || editor.validation) && <p class="zie-error" role="alert">{editor.error || editor.validation}</p>}
    <footer class="zie-footer"><button type="button" disabled={editor.saving || !editor.ready || !!editor.validation} onClick={() => void editor.save('replace')}>Save</button><button type="button" disabled={editor.saving || !editor.ready || !!editor.validation || props.canSaveCopy === false} onClick={() => void editor.save('copy')}>Save as copy</button><button type="button" disabled={editor.saving} onClick={editor.cancel}>Cancel</button></footer>
  </section>;
}
