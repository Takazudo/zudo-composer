# Image editor core

Private, source-only, zero-dependency RGBA editing service. Root packaging ships
runtime files individually; installed Vite aliases resolve the core and worker
without a host workspace. The UI entry is reserved for the UI package work.

`createEditDoc(size)` creates normalized crop coordinates in the oriented source.
`resizeCropRect(start, handle, delta, orientedPixelSize, {aspect, fromCenter})`
uses normalized deltas and physical-pixel aspect ratios. Shift callers pass the
starting physical ratio; Alt callers set fromCenter. Quarter-turn actions call
`rotateCropRect` and swap resize width/height for odd turns; flips call
`flipCropRect`. Aspect presets change crop only. Minimum interactive crop is
one percent or one source pixel per axis. Impossible aspect constraints throw.

`renderToRgba(doc, source, {maxEdge})` preserves source bytes and applies
rotation/flips, crop (floor starts/ceil ends), resampling, then tone. Exact area
reduction and normalized Lanczos3 expansion use premultiplied alpha and bounded
row scratch; mixed-axis jobs use each axis's kernel. Brightness/contrast use a
256-entry LUT. Hue/saturation rotate/scale YIQ chroma. Neutral tone is byte exact.
These conventional filters cannot recover missing image detail.

`createImageEditorClient()` from `./worker` owns one resident source and worker.
Await `registerSource(rgba, optionalId)`, then request `renderPreview(doc)` or
`renderFull(doc)`. Preview is limited to 1024px; full export uses exact requested
dimensions. Superseded previews reject with `ImageEditorError('superseded')`.
The queue retains one active render and one trailing preview. Full render
snapshots are independent of preview generations. UI callers debounce previews
120ms, display pending status, and freeze edits while saving. Release on source
replacement/close and always dispose the service. Source registration clones and
transfers pixels once. Worker-unavailable fallback yields every sixteen rows;
it is cooperative CPU processing and cold/full jobs can still be expensive.

A single untinted geometry preview is cached; source identity or geometry changes
invalidate it. No full-size cache or pixel undo history exists. `createHistory`
records committed gesture documents, caps 100 entries and serialized UTF-8 bytes
(default 256 MiB); construct a new history on source replacement. Reset is undoable.
The byte count is serialized document storage, not total JavaScript heap usage.

Dimensions are guarded before allocation: at most 40 million pixels per image,
plus a conservative 512 MiB tracked working set. Native decoding/encoding and
browser overhead remain additional. `MAX_ENCODED_BYTES` is 25 MiB. `encode`
prefers OffscreenCanvas and supports injected canvas/ImageData factories for
node tests; HTML canvas is the fallback. JPEG flattens onto white; JPEG/WebP
quality defaults to 0.9. MIME fallback, null blobs and byte overflow are typed
errors; callers retain the editing session and do not silently reduce quality.

GIF remains outside the current editor contract: the Assets gate rejects
`image/gif` before fetching or decoding. Native canvas has no animated GIF
encoder (a direct `image/gif` request falls back to PNG), while the core
`encode` function independently rejects that unsupported MIME before calling
canvas, so an animated source is never silently flattened. The
[GIF assessment](../../docs/gif-editing-assessment.md) concludes that GIF
editing and GIF-to-still conversion are outside the product scope; no
implementation is planned. Existing GIF assets remain usable without editing.
