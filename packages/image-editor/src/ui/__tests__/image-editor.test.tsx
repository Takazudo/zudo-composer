import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditDoc, RgbaImage } from '../../index';
import { ImageEditor } from '../image-editor';
import { documentError } from '../use-editor-state';
const mocks = vi.hoisted(() => ({ clients: [] as { registerSource: ReturnType<typeof vi.fn>; renderPreview: ReturnType<typeof vi.fn>; renderFull: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[], encode: vi.fn(), paint: vi.fn() }));
vi.mock('../../worker/client', () => ({ createImageEditorClient: () => {
  const client = { registerSource: vi.fn().mockResolvedValue({}), renderPreview: vi.fn(async (doc: EditDoc) => ({ ...doc.resize, data: new Uint8ClampedArray(4) })), renderFull: vi.fn(async (doc: EditDoc) => ({ ...doc.resize, data: new Uint8ClampedArray(4) })), dispose: vi.fn() };
  mocks.clients.push(client); return client;
} }));
vi.mock('../../core/encode', () => ({ encode: mocks.encode }));
function source(width = 400, height = 300): ImageData { return { width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' } as ImageData; }
async function flush(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount(extra: Partial<Parameters<typeof ImageEditor>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined), onCancel = vi.fn();
  const props = { source: source(), mimeType: 'image/jpeg' as const, onSave, onCancel, ...extra };
  const result = render(<ImageEditor {...props} />); await flush(); await flush(120);
  return { ...result, props, onSave, onCancel, client: mocks.clients.at(-1)! };
}
const click = (label: string) => fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
function lastDoc(): EditDoc { return mocks.clients.at(-1)!.renderFull.mock.calls.at(-1)![0]; }
function pointer(node: Element, type: string, init: Record<string, unknown>) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ pointerId: 1, button: 0, clientX: 0, clientY: 0, ...init })) Object.defineProperty(event, key, { value });
  fireEvent(node, event);
}
beforeEach(() => {
  vi.useFakeTimers(); mocks.clients.length = 0; mocks.paint.mockReset(); mocks.encode.mockReset().mockImplementation(async (_image, options) => new Blob(['encoded'], { type: options.type }));
  vi.stubGlobal('ImageData', class { data: Uint8ClampedArray; width: number; height: number; constructor(data: Uint8ClampedArray, width: number, height: number) { this.data = data; this.width = width; this.height = height; } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData: mocks.paint } as unknown as CanvasRenderingContext2D);
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('image editor UI contract', () => {
  it('edits the real document with every tool, and uses full-size MIME-preserving export', async () => {
    const { onSave, client } = await mount({ source: source(2400, 1200) });
    fireEvent.change(screen.getByLabelText('Crop aspect'), { target: { value: '1' } });
    expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('1200 × 1200');
    click('Rotate'); click('Flip horizontal'); click('Rotate 90° clockwise');
    click('Resize'); fireEvent.input(screen.getByLabelText('Output width'), { target: { value: '1800' } });
    click('Tone'); fireEvent.change(screen.getByLabelText('brightness value'), { target: { value: '25' } });
    click('Save'); await flush();
    const doc = lastDoc(); expect(doc.resize).toEqual({ width: 1800, height: 1800 }); expect(doc.rotate).toBe(90); expect(doc.flipH).toBe(false); expect(doc.flipV).toBe(true); expect(doc.tone.brightness).toBe(25); expect(doc.crop.height).toBe(.5);
    expect(client.renderFull).toHaveBeenCalledTimes(1); expect(mocks.encode).toHaveBeenCalledWith(expect.objectContaining({ width: 1800, height: 1800 }), { type: 'image/jpeg', quality: .9 });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/jpeg' }), 'replace');
  });
  it('round-trips undo, redo and undoable reset', async () => {
    await mount(); click('Rotate'); click('Rotate 90° clockwise'); expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('300 × 400');
    click('Undo'); expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('400 × 300');
    click('Redo'); click('Reset'); expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('400 × 300');
    click('Undo'); expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('300 × 400');
  });
  it('uses oriented uncropped previews in Crop and final cropped previews elsewhere', async () => {
    const { client } = await mount(); fireEvent.change(screen.getByLabelText('Crop aspect'), { target: { value: '1' } }); await flush(120);
    expect(client.renderPreview.mock.calls.at(-1)![0].crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    click('Tone'); await flush(120); expect(client.renderPreview.mock.calls.at(-1)![0].crop.width).toBe(.75);
    click('Rotate'); click('Rotate 90° clockwise'); click('Crop'); await flush(120);
    expect(client.renderPreview.mock.calls.at(-1)![0].resize).toEqual({ width: 300, height: 400 });
  });
  it('discards an older preview even when it arrives after the latest', async () => {
    const { client } = await mount(); let old!: (r: RgbaImage) => void, latest!: (r: RgbaImage) => void;
    client.renderPreview.mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockImplementationOnce(() => new Promise(resolve => { latest = resolve; }));
    click('Tone'); await flush(120); fireEvent.change(screen.getByLabelText('brightness value'), { target: { value: '10' } }); await flush(120);
    await act(async () => latest({ width: 2, height: 2, data: new Uint8ClampedArray(16).fill(2) }));
    const count = mocks.paint.mock.calls.length;
    await act(async () => old({ width: 1, height: 1, data: new Uint8ClampedArray(4).fill(1) }));
    expect(mocks.paint).toHaveBeenCalledTimes(count); expect(mocks.paint.mock.calls.at(-1)![0].width).toBe(2);
  });
  it('coalesces crop gestures, maps transformed coordinates, and rolls back pointer cancellation', async () => {
    await mount(); const handle = screen.getByLabelText('Resize crop bottom right');
    vi.spyOn(document.querySelector('.zie-crop-overlay')!, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 600 } as DOMRect);
    pointer(handle, 'pointerdown', { clientX: 800, clientY: 600 }); pointer(handle, 'pointermove', { clientX: 600, clientY: 450 }); pointer(handle, 'pointermove', { clientX: 400, clientY: 300 }); pointer(handle, 'pointerup', {});
    expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('200 × 150'); click('Undo'); expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('400 × 300'); expect(screen.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    pointer(handle, 'pointerdown', { clientX: 800, clientY: 600 }); pointer(handle, 'pointermove', { clientX: 400, clientY: 300 }); pointer(handle, 'pointercancel', {});
    expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('400 × 300');
  });
  it('supports aspect/center modifiers and handle-axis keyboard resizing without stealing input arrows', async () => {
    await mount(); const handle = screen.getByLabelText('Resize crop bottom right');
    vi.spyOn(document.querySelector('.zie-crop-overlay')!, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 300 } as DOMRect);
    pointer(handle, 'pointerdown', { clientX: 400, clientY: 300 }); pointer(handle, 'pointermove', { clientX: 350, clientY: 300, shiftKey: true, altKey: true }); pointer(handle, 'pointerup', {});
    expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('300 × 225');
    fireEvent.keyDown(screen.getByLabelText('Resize crop right'), { key: 'ArrowLeft', shiftKey: true }); expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('290 × 225');
    click('Resize'); fireEvent.keyDown(screen.getByLabelText('Output width'), { key: 'ArrowLeft' }); expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('290 × 225');
  });
  it('keeps save frozen through encoding and host persistence and retains history on failure', async () => {
    let resolve!: () => void; const pending = new Promise<void>(r => { resolve = r; }); const onSave = vi.fn(() => pending); const onSavingChange = vi.fn();
    const { onCancel } = await mount({ onSave, onSavingChange }); click('Rotate'); click('Flip vertical'); click('Save'); click('Save'); await flush();
    expect(onSave).toHaveBeenCalledTimes(1); expect(onSavingChange).toHaveBeenLastCalledWith(true); expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('Image editor'), { key: 'Escape' }); expect(onCancel).not.toHaveBeenCalled();
    await act(async () => resolve()); expect(onSavingChange).toHaveBeenLastCalledWith(false);
    onSave.mockImplementationOnce(() => Promise.reject(new Error('write failed'))); click('Save'); await flush(); expect(screen.getByRole('alert')).toHaveTextContent('write failed'); expect(screen.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    click('Undo'); click('Save'); await flush(); expect(lastDoc().flipV).toBe(false);
  });
  it('disables unsupported copy and delegates Escape only once', async () => {
    const { onCancel } = await mount({ canSaveCopy: false }); expect(screen.getByRole('button', { name: 'Save as copy' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('Image editor'), { key: 'Escape' }); fireEvent.keyDown(screen.getByLabelText('Image editor'), { key: 'Escape' }); expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it('disposes old worker on source replacement and on unmount without closing caller bitmap', async () => {
    const close = vi.fn(); const bitmap = { width: 400, height: 300, close } as unknown as ImageBitmap;
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({ putImageData: mocks.paint, drawImage: vi.fn(), getImageData: () => source() } as unknown as CanvasRenderingContext2D);
    const { rerender, unmount, props, client } = await mount({ source: bitmap }); click('Rotate'); click('Flip horizontal');
    rerender(<ImageEditor {...props} source={source(200, 100)} />); await flush(); expect(client.dispose).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('200 × 100'); expect(screen.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await flush(120); expect(mocks.clients.at(-1)!.renderPreview).toHaveBeenCalledWith(expect.objectContaining({ resize: { width: 200, height: 100 } }));
    unmount(); expect(mocks.clients.at(-1)!.dispose).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
  });
  it('refuses invalid dimensions and 200% above 40 MP before requesting a full render', async () => {
    const { client } = await mount({ source: { width: 4000, height: 3000, data: new Uint8ClampedArray(4) } as ImageData });
    click('Resize'); click('200%'); expect(screen.getByRole('alert')).toHaveTextContent('40 MP'); expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled(); expect(client.renderFull).not.toHaveBeenCalled();
    click('50%'); expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeEnabled(); fireEvent.input(screen.getByLabelText('Output width'), { target: { value: '0' } }); expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  });
  it.each(['image/png', 'image/webp'] as const)('saves copy using exact %s and rejects MIME fallback or oversized blobs', async mimeType => {
    const { onSave } = await mount({ mimeType }); click('Save as copy'); await flush(); expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: mimeType }), 'copy');
    mocks.encode.mockResolvedValueOnce(new Blob(['bad'], { type: 'image/gif' })); click('Save'); await flush(); expect(onSave).toHaveBeenCalledTimes(1); expect(screen.getByRole('alert')).toHaveTextContent('MIME');
    mocks.encode.mockResolvedValueOnce({ type: mimeType, size: 26 * 1024 * 1024 }); click('Save'); await flush(); expect(onSave).toHaveBeenCalledTimes(1); expect(screen.getByRole('alert')).toHaveTextContent('25 MiB');
  });
  it('leaves native Space activation available on toolbar and save buttons', async () => {
    await mount();
    for (const name of ['Tone', 'Save', 'Cancel']) {
      const event = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
      fireEvent(screen.getByRole('button', { name, exact: true }), event);
      expect(event.defaultPrevented).toBe(false);
    }
  });
  it('zooms about pointer, pans by wheel and Space drag, and rolls cancelled pan back', async () => {
    await mount(); const stage = screen.getByLabelText('Image preview; Space drag to pan');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 400, left: 0, top: 0 } as DOMRect);
    fireEvent.wheel(stage, { ctrlKey: true, deltaY: -10, clientX: 420, clientY: 200 });
    expect(screen.getByLabelText('Zoom')).toHaveTextContent('125%');
    expect(document.querySelector('.zie-image')).toHaveStyle({ transform: 'translate(-50%, -50%) translate(-25px, 0px) scale(1.25)' });
    fireEvent.wheel(stage, { deltaX: 10, deltaY: 20 });
    fireEvent.keyDown(stage, { key: ' ', code: 'Space' }); pointer(stage, 'pointerdown', { clientX: 0, clientY: 0 }); pointer(stage, 'pointermove', { clientX: 100, clientY: 50 });
    expect(document.querySelector('.zie-image')).toHaveStyle({ transform: 'translate(-50%, -50%) translate(65px, 30px) scale(1.25)' });
    pointer(stage, 'pointercancel', {}); fireEvent.keyUp(stage, { key: ' ', code: 'Space' });
    expect(document.querySelector('.zie-image')).toHaveStyle({ transform: 'translate(-50%, -50%) translate(-35px, -20px) scale(1.25)' });
  });
  it('commits range gestures once, cancels them, and supports all tone numeric fields and field reset', async () => {
    await mount(); click('Tone'); const range = screen.getByLabelText('contrast');
    pointer(range, 'pointerdown', {}); fireEvent.input(range, { target: { value: '20' } }); fireEvent.input(range, { target: { value: '40' } }); pointer(range, 'pointerup', {});
    click('Undo'); expect(screen.getByLabelText('contrast value')).toHaveValue(0); expect(screen.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    pointer(range, 'pointerdown', {}); fireEvent.input(range, { target: { value: '30' } }); pointer(range, 'pointercancel', {}); expect(screen.getByLabelText('contrast value')).toHaveValue(0);
    for (const name of ['brightness', 'contrast', 'saturation', 'hue']) fireEvent.change(screen.getByLabelText(`${name} value`), { target: { value: '35' } });
    click('Reset saturation'); click('Save'); await flush(); expect(lastDoc().tone).toEqual({ brightness: 35, contrast: 35, saturation: 0, hue: 35 });
  });
  it('freezes cancel and editing already during full render and encoding', async () => {
    const { client, onCancel, onSave } = await mount(); let full!: (image: RgbaImage) => void, encoded!: (blob: Blob) => void;
    client.renderFull.mockImplementationOnce(() => new Promise(resolve => { full = resolve; }));
    mocks.encode.mockImplementationOnce(() => new Promise(resolve => { encoded = resolve; }));
    click('Save'); await flush(); expect(screen.getByRole('button', { name: 'Tone', exact: true })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('Image editor'), { key: 'Escape' }); expect(onCancel).not.toHaveBeenCalled();
    await act(async () => full({ width: 400, height: 300, data: new Uint8ClampedArray(4) }));
    expect(screen.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled(); expect(onSave).not.toHaveBeenCalled();
    await act(async () => encoded(new Blob(['ok'], { type: 'image/jpeg' })));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
  it('invalidates an in-flight result when unmounted and clears the preview canvas', async () => {
    const { client, unmount } = await mount(); const canvas = screen.getByLabelText('Edited image') as HTMLCanvasElement;
    let finish!: (image: RgbaImage) => void; client.renderPreview.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    click('Tone'); await flush(120); const calls = mocks.paint.mock.calls.length; unmount();
    await act(async () => finish({ width: 2, height: 2, data: new Uint8ClampedArray(16) }));
    expect(mocks.paint).toHaveBeenCalledTimes(calls); expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  });
  it('resets the aspect selector with source replacement and reset', async () => {
    const { rerender, props } = await mount(); fireEvent.change(screen.getByLabelText('Crop aspect'), { target: { value: '1' } }); click('Reset'); expect(screen.getByLabelText('Crop aspect')).toHaveValue('free');
    fireEvent.change(screen.getByLabelText('Crop aspect'), { target: { value: '1' } }); rerender(<ImageEditor {...props} source={source(200, 100)} />); await flush(); expect(screen.getByLabelText('Crop aspect')).toHaveValue('free');
  });
  it('guards bitmap conversion before allocating a readback canvas', async () => {
    const bitmap = { width: 7000, height: 5000, close: vi.fn() } as unknown as ImageBitmap;
    const { client } = await mount({ source: bitmap }); expect(screen.getByRole('alert')).toHaveTextContent('memory-limit'); expect(client.registerSource).not.toHaveBeenCalled();
  });
  it('can preview a large source whose full render must be cropped before save', async () => {
    const { client } = await mount({ source: { width: 5000, height: 4000, data: new Uint8ClampedArray(4) } as ImageData });
    expect(client.renderPreview).toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Crop aspect'), { target: { value: String(1200 / 630) } });
    click('Resize'); click('50%'); expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  });
  it('does not revive a crop gesture after undo interrupts it', async () => {
    await mount(); fireEvent.change(screen.getByLabelText('Crop aspect'), { target: { value: '1' } });
    const handle = screen.getByLabelText('Resize crop bottom right');
    vi.spyOn(document.querySelector('.zie-crop-overlay')!, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 300 } as DOMRect);
    pointer(handle, 'pointerdown', { clientX: 350, clientY: 300 }); pointer(handle, 'pointermove', { clientX: 300, clientY: 250 }); click('Undo');
    pointer(handle, 'pointermove', { clientX: 250, clientY: 200 }); pointer(handle, 'pointerup', {});
    expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('400 × 300'); expect(screen.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });
  it('preserves locked aspect through successive integer rounding while typing dimensions', async () => {
    await mount(); click('Resize'); const width = screen.getByLabelText('Output width');
    for (const value of ['', '1', '10', '100']) fireEvent.input(width, { target: { value } });
    expect(screen.getByLabelText('Output dimensions')).toHaveTextContent('100 × 75');
  });
  it.each(['data', 'bitmap'] as const)('normalizes browser-shaped %s readback to an explicit worker DTO', async kind => {
    const pixels = new Uint8ClampedArray(400 * 300 * 4);
    class NativeImageDataShape {
      get width() { return 400; }
      get height() { return 300; }
      get data() { return pixels; }
    }
    const native = new NativeImageDataShape();
    const close = vi.fn();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({ putImageData: mocks.paint, drawImage: vi.fn(), getImageData: () => native } as unknown as CanvasRenderingContext2D);
    const source = kind === 'data' ? native as ImageData : { width: 400, height: 300, close } as unknown as ImageBitmap;
    const { client } = await mount({ source });
    const registered = client.registerSource.mock.calls[0][0];
    expect(Object.keys(registered).sort()).toEqual(['data', 'height', 'width']);
    expect(registered).toEqual({ width: 400, height: 300, data: pixels });
    expect(registered.data).toBe(pixels);
    expect(Object.keys(native)).toEqual([]);
    expect(close).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'] as const)('restores a cancelled preview when save %s before the preview debounce', async outcome => {
    let complete!: () => void, fail!: (reason: Error) => void;
    const pending = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    const { client } = await mount({ onSave: () => pending });
    click('Tone'); fireEvent.change(screen.getByLabelText('brightness value'), { target: { value: '20' } });
    const canvas = screen.getByLabelText('Edited image') as HTMLCanvasElement;
    expect(canvas.width).toBe(0);
    const before = client.renderPreview.mock.calls.length;
    click('Save'); await flush(); expect(client.renderPreview).toHaveBeenCalledTimes(before);
    await act(async () => { if (outcome === 'resolve') complete(); else fail(new Error('write failed')); });
    expect(screen.getByText('Rendering preview…')).toHaveAttribute('role', 'status');
    await flush(120);
    expect(client.renderPreview).toHaveBeenCalledTimes(before + 1);
    expect(client.renderPreview.mock.calls.at(-1)![0].tone.brightness).toBe(20);
    expect(canvas.width).toBe(400);
    if (outcome === 'reject') expect(screen.getByRole('alert')).toHaveTextContent('write failed');
  });
  it('restores preview after an immediate encode rejection without losing its error', async () => {
    const { client } = await mount(); click('Tone');
    mocks.encode.mockRejectedValueOnce(new Error('encode failed'));
    click('Save'); await flush(); await flush(120);
    expect(client.renderPreview.mock.calls.at(-1)![0].crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect((screen.getByLabelText('Edited image') as HTMLCanvasElement).width).toBe(400);
    expect(screen.getByRole('alert')).toHaveTextContent('encode failed');
  });
  it('guards the working set for otherwise legal output sizes', () => {
    const doc: EditDoc = { crop: { x: 0, y: 0, width: 1, height: 1 }, rotate: 0, flipH: false, flipV: false, resize: { width: 6000, height: 6000 }, tone: { brightness: 0, contrast: 0, saturation: 0, hue: 0 } };
    expect(documentError(doc, { width: 4000, height: 3000 })).toContain('memory-limit');
  });
});
