# GIF editing assessment

**Decision: do not support GIF editing or GIF-to-still conversion in Composer.** Keep GIF excluded from the image editor, with a clear explanation and no silent flattening. There is no deferred GIF implementation or follow-up feature on the roadmap.

The product owner confirmed this scope after reviewing the assessment on September 10, 2026. It supersedes the initial recommendation of option B (explicit still PNG conversion, deferred). The measurements below remain useful evidence; they do not constitute an implementation plan.

Animation-preserving editing requires significant encoding, quality, memory and lifecycle work. Still conversion is simpler, but still adds extraction, acknowledgment, error handling and testing for a feature that is not a product priority. That cost is not justified here. This is a product-scope decision, not a claim that GIF is unused everywhere or technically impossible.

Existing GIF assets remain usable through the ordinary asset workflow; the editor does not fetch, decode, transform or export them. Users who need an editable still can convert it externally and upload PNG, JPEG or WebP.

## Scope and platform findings

Assessment for [#458](https://github.com/Takazudo/zudo-composer/issues/458), answering [#444](https://github.com/Takazudo/zudo-composer/issues/444). Repository measured at `d73894d3224c251c5e3381e17f921952b1dd01d6`; measurements taken September 10, 2026 JST (some UTC timestamps are September 9). No production GIF editing or conversion is implemented here.

1. **Chromium ImageDecoder decodes composited GIF frames in a secure context.** The measured harness used `http://localhost`; probing `about:blank` would incorrectly report unavailable. Returned `VideoFrame` objects carry dimensions, timestamps and durations. Pixel tests, not `VideoFrame.format`, establish alpha. Original disposal instructions, palettes and patch rectangles are not exposed by the API; source bytes remain parseable. See [WebCodecs](https://www.w3.org/TR/webcodecs/) and [GIF89a](https://www.w3.org/Graphics/GIF/spec-gif89a.txt).
2. **Canvas does not supply an animated GIF encoder.** A direct `OffscreenCanvas.convertToBlob({type: "image/gif"})` probe returned PNG, not GIF. The current [encoder](../packages/image-editor/src/core/encode.ts) rejects GIF with `unsupported-mime` *before* calling canvas; its later MIME mismatch check rejects fallback among allowed formats with `encode-failed`. This corrects the planning issue's conflation of the two paths. PNG encoding is native; APNG can reuse those compressed PNG frames with a container muxer. See [HTML bitmap serialization](https://html.spec.whatwg.org/multipage/canvas.html#serialising-bitmaps-to-a-file) and [PNG/APNG](https://www.w3.org/TR/png-3/).

The conclusion is a product and maintenance judgment informed by measurements, not a claim that animation editing is impossible. A small sequence is feasible. Sequential processing reduces retained RGBA but still requires frame-provider ownership, cancellation, progress and aggregate limits. Edited GIF output introduces palette and binary-alpha loss. Explicit still conversion was assessed as a smaller alternative, but is also excluded from the product scope.

The evidence labels used below are: G0 fixture corpus, GD format feasibility review, G1 decode probe, G2a GIF writer, G2b no-edit output comparison, and G3 actual edit benchmark. All are summarized here; no external prototype directory is required.

## Current preservation contract

The editor rejects GIF before fetching or decoding and never mounts an editing surface for it. It produces no replacement or converted file, so it does not change source frames, timing, disposal instructions, transparency or loop metadata. This is a refusal-to-edit guarantee, not a promise to edit while preserving animation.

### Rejected still-conversion alternative

The table below records the measured tradeoffs of option B, which was considered and rejected. None of its conversion behavior is implemented or planned.

| Property from #444 | Tradeoff of rejected option B | Evidence and limits |
|---|---|---|
| Frames | **Deliberately dropped**, except the explicitly selected composited frame, whose visible content is preserved before intentional edits | G1 returned all 358 frames, establishing access; G2b's PNG frame 0 exactly matched independent Pillow decoding of every original fixture, including alpha. The assessed prototype selected frame 0 deliberately. This does not prove arbitrary-frame selector UX or edited PNG fidelity. |
| Timing | **Deliberately dropped** | PNG still output in G2b contains one image, with no animation transitions, duration sequence or loops. G1/G2b preserved raw GIF 0/1/2cs metadata on animated paths, but B has no use for that sequence. Finite/infinite repeat behavior is also dropped, never described as preserved. |
| Disposal modes | **Instructions deliberately dropped; selected-frame composited appearance preserved in measured extraction** | G1 matched all synthetic pixels after keep/background/previous disposal, but returned full logical canvases without disposal or original rectangles. Source bytes could be parsed to recover instructions; ImageDecoder output alone cannot. B needs the already-composited frame, so no reconstruction is required. The cost is loss of animation authoring/diff data and the ability to round-trip original animation structure; retaining the original asset preserves access to its bytes. |
| Transparency | **Preserved in measured no-edit selected-frame PNG; preservation after future edits is a design inference requiring validation** | G1 matched all 320 synthetic RGBA bytes, including eight transparent pixel occurrences; G2b's selected PNG matched original pixels/alpha independently. G3 actually generated partial alpha during resizing and GIF thresholding changed all 25 partial-alpha pixels. PNG's alpha-capable path was the assessed alternative, but G3 did not encode edited still PNG. Do not call that edited path measured or claim an independent oracle validated the edit kernel itself. |

The one-frame source without a loop extension returned `repetitionCount=Infinity` in G1 despite that source metadata. B discards loop semantics intentionally; a future animation path must handle the anomaly and finite/infinite values before serialization (`Infinity` becomes JSON `null`). GIF requests are currently rejected as unsupported MIME before native encoding; the separate allowed-format MIME mismatch guard also prevents silent fallback. Native canvas's GIF request producing PNG is not an animated GIF encoder.

## Fixture corpus and reconstruction

Each real fixture was downloaded unchanged from the public source linked below. Preserve attribution/license notices when redistributing it. The fixture IDs below are used throughout the tables. No generated fixture or prototype is added to the production package.

| ID | Dimensions | Frames | Original bytes | Source / attribution / license |
|---|---:|---:|---:|---|
| synthetic-disposal-methods | 4×3 | 4 | 129 | Byte-built synthetic; exact bytes below |
| synthetic-fixed-loop | 3×2 | 3 | 120 | Byte-built synthetic; exact bytes below |
| synthetic-infinite-loop | 2×2 | 2 | 95 | Byte-built synthetic; exact bytes below |
| synthetic-transparent-pixels | 3×2 | 1 | 53 | Byte-built synthetic; exact bytes below |
| real-high-frame-parallax | 200×150 | 119 | 720294 | [Nathaniel Domek](https://commons.wikimedia.org/wiki/File:Parallax.gif); [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/); [unchanged GIF](https://upload.wikimedia.org/wikipedia/commons/a/ab/Parallax.gif) |
| real-photographic-dithered | 571×692 | 219 | 458814 | [Morn; based on a photograph by Charles J. Sharp](https://commons.wikimedia.org/wiki/File:Interlaced_GIF_demo.gif); [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); [unchanged GIF](https://upload.wikimedia.org/wikipedia/commons/6/6d/Interlaced_GIF_demo.gif) |
| real-large-canvas | 1000×1000 | 10 | 340105 | [Kaethe17, Wikiolo, Universalamateur; edited by Habitator terrae](https://commons.wikimedia.org/wiki/File:Animated.gif); [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); [unchanged GIF](https://upload.wikimedia.org/wikipedia/commons/b/b1/Animated.gif) |

SHA-256 of the exact source files:

| ID | SHA-256 |
|---|---|
| synthetic-disposal-methods | `818b8e20c929642a60ff7bae20abdb4d00bf95b00933ccf6d2b57ac8dc7c43cf` |
| synthetic-fixed-loop | `179bd2a0b9160e6d227dc53facb6dbe0bed8c8895b00c59ffd32e17f7a0451c2` |
| synthetic-infinite-loop | `0bb4600a88c36cb2b24f906c53506d228b6ef9c9e87ab089d0ff6d94294f7c81` |
| synthetic-transparent-pixels | `dac894bf08aa7431ae2b40e1bc16a9d743d588610d3fdcd83f07ea31ec0c0749` |
| real-high-frame-parallax | `ba93abfe376adc7cc473f8109988cc46d6214f29ad84e6fd9911b01b40c8497c` |
| real-photographic-dithered | `736395d045964d5682b191a289df1494d69a7efd2ff37b1eb11f1f6f10fbb02a` |
| real-large-canvas | `577b620ed2ce05696ff1d4b1ca51f19ebfe60122cb1a053461785fb384949103` |

The four synthetic files can be reconstructed without an external generator: decode each base64 payload into the indicated `.gif`, then compare its SHA-256 above. For example, in Node use `writeFileSync("fixture.gif", Buffer.from(payload, "base64"))`. All use logical-screen background index 0 and a four-entry global palette: transparent black (index 0 when the GCE marks it transparent), red `(238,56,56)`, green `(48,210,106)`, blue `(48,104,244)`. Their literal GIF LZW streams clear before each literal, so dictionary growth cannot obscure the expected pixels.

| ID | Exact base64 bytes |
|---|---|
| synthetic-disposal-methods | `R0lGODlhBAADAPEAAAAAAO44ODDSajBo9CH5BAUAAAAALAAAAAAEAAMAAAIKDMMwDMMwDMMwLAAh+QQJAQAAACwBAAEAAgABAAACAxTBAgAh+QQNAgAAACwCAAEAAQABAAACAhwLACH5BAUDAAAALAAAAAACAAIAAAIEBEURLAA7` |
| synthetic-fixed-loop | `R0lGODlhAwACAPEAAAAAAO44ODDSajBo9CH/C05FVFNDQVBFMi4wAwEDAAAh+QQFAAAAACwAAAAAAwACAAACBgzDMAzDAgAh+QQFAQAAACwBAAAAAQACAAACAxTHAgAh+QQFAgAAACwAAAEAAwABAAACAwRHsAA7` |
| synthetic-infinite-loop | `R0lGODlhAgACAPEAAAAAAO44ODDSajBo9CH/C05FVFNDQVBFMi4wAwEAAAAh+QQFAgAAACwAAAAAAgACAAACBAxBMCwAIfkECQAAAAAsAAAAAAIAAgAAAgQERREsADs=` |
| synthetic-transparent-pixels | `R0lGODlhAwACAPEAAAAAAO44ODDSajBo9CH5BAUBAAAALAAAAAADAAIAAAIGBEMwBMMCADs=` |

Synthetic source controls and expected composited pixels follow. `.` = transparent black, `R/G/B` = palette colors above, `/` separates rows. A transparent source index leaves the prior canvas pixel unchanged; disposal 2 clears its rectangle before the next frame, disposal 3 restores the pre-frame canvas. These expected canvases are an oracle, not decoder output.

| Fixture/frame | Source rectangle x,y,w,h | Delay cs | Disposal | Transparent index | Expected canvas rows |
|---|---|---:|---:|---:|---|
| synthetic-disposal-methods / 0 | 0,0,4,3 | 0 | 1 | 0 | `RRRR/RRRR/RRRR` |
| synthetic-disposal-methods / 1 | 1,1,2,1 | 1 | 2 | 0 | `RRRR/RGRR/RRRR` |
| synthetic-disposal-methods / 2 | 2,1,1,1 | 2 | 3 | 0 | `RRRR/R.BR/RRRR` |
| synthetic-disposal-methods / 3 | 0,0,2,2 | 3 | 1 | 0 | `RGRR/G..R/RRRR` |
| synthetic-fixed-loop / 0 | 0,0,3,2 | 0 | 1 | 0 | `RRR/RRR` |
| synthetic-fixed-loop / 1 | 1,0,1,2 | 1 | 1 | 0 | `RGR/RBR` |
| synthetic-fixed-loop / 2 | 0,1,3,1 | 2 | 1 | 0 | `RGR/RBR` |
| synthetic-infinite-loop / 0 | 0,0,2,2 | 2 | 1 | 0 | `R./.R` |
| synthetic-infinite-loop / 1 | 0,0,2,2 | 0 | 2 | 0 | `RG/GR` |
| synthetic-transparent-pixels / 0 | 0,0,3,2 | 1 | 1 | 0 | `.R./R.R` |

Loop extension values: fixed-loop contains NETSCAPE2.0 repeat count 3 (four total plays); infinite-loop contains 0 (endless); disposal-methods and transparent-pixels have no loop extension. All three real sources loop endlessly. Read source GCE delays and image descriptors from the hashed file, not from browser output. Real parallax delays are 4cs, photographic delays 8/9cs, and large-canvas delays 5cs. The fixture corpus's independent manifest/parser checks passed 1,926 assertions.

## Measurement method

**Hardware/software:** AMD Ryzen 5 5600XT 6-Core Processor, 12 logical CPUs; Linux `6.6.114.1-microsoft-standard-WSL2` x64; Chromium `151.0.7922.34`; Playwright `1.62.1`, Node `24.13.1`; independent original-file comparison used Pillow `12.2.0`. Browser launches were serialized by a machine-global guard. These are one-machine measurements, not cross-browser support or service-level promises.

Serve a small harness and the fixtures on an ephemeral `http://localhost` port. Import Playwright through this repository's `@playwright/test` package so pnpm resolution works. Navigate before probing `ImageDecoder`; launch with `--enable-precise-memory-info`. Use `try/finally` to close each VideoFrame, decoder, browser and server. Each timing stage uses `performance.now()` inside the page, not Node wall time. Save all repetitions and report median plus minimum/maximum; do not replace missing runs with estimates.

- **Decode probe:** source fetch and fidelity canvas readback outside timing. One warmup then five measured repetitions per fixture; fresh ImageDecoder per repetition, reused page/browser. Start before decoder construction, await tracks.ready, sequentially decode/close every frame, finish after decoder.close. Record VideoFrame duration/timestamp before close. Test `repetitionCount === Infinity` in-page before JSON transport. Compare all synthetic pixels against the oracle above and all frame delays against the source parser.
- **No-edit encoding:** decode all frames to RGBA before timing. One warmup then five measured repetitions per candidate/fixture. Time quantization/LZW/container or native PNG compression/APNG muxing through final assembly. GIF/APNG process every frame; still PNG processes explicitly selected frame 0. No edits occur in this stage. Eager prepared source frames and previous output remain resident, so the still-PNG memory result is not a dedicated still-conversion resource measurement.
- **Actual editing:** five measured repetitions per strategy/case, no excluded warmup; alternate strategy order, use a fresh page/context each run but one browser process tree. Transpile the measured repository core without changing it and call `renderToRgba` per frame. Eager retains all source RGBA, then all edited RGBA, then encodes; sequential decodes/edits/appends/releases one frame at a time. Both retain compressed chunks through final contiguous assembly. Start before decoder construction, end after writer.finish; initial fetch and post-run quality comparison are outside timing. Eager decoder.close is inside total, sequential final decoder cleanup is after total.
- **Memory:** sample summed `/proc/<pid>/status` VmRSS over the Chromium process tree every 20ms for decode and 25ms for encoding/editing, plus boundaries; exclude Node. Sample `performance.memory.usedJSHeapSize` at frame boundaries (and after finish in editing). RSS can double-count shared pages and miss spikes; browser caches/allocator retention survive runs. JS samples miss synchronous allocation peaks and omit native allocations. Count held RGBA separately. None of these establishes a true isolated native-memory maximum.
- **Quality/playback:** decode original GIF and output independently with Pillow; compare all RGBA channels. Browser ImageDecoder checks all output frames, delays and loops. Use original HTMLImageElement frame-0 center crops against output frame 0 for visible quality, not animation playback. For playback use time-separated screenshots of actual img rendering on gray. A two-frame, 200ms-per-frame control with two total plays distinguishes motion, transparent replacement, repetition and stop. Sample around 40/250/450/650/900/1100ms; report actual capture times. Sparse sequential screenshots do not establish exact short-delay cadence.

Prototype transport initially exhausted Node's 2GiB heap while copying a large byte array through Playwright JSON. This was outside encode timing; bounded 64KiB base64 transport fixed it and the remaining cases were rerun. It is not an encoder failure or a resource limit of the product. The quality capture filter was also corrected before all three real-file crop comparisons were accepted.

### Exact edit document

```ts
const doc = {
  crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
  rotate: 0, flipH: false, flipV: false,
  resize: { width: Math.round(source.width * 0.63),
            height: Math.round(source.height * 0.63) },
  tone: { brightness: 7, contrast: 9, saturation: 12, hue: 8 },
};
// For the 3×2 transparent synthetic only, resize is { width: 7, height: 5 }.
const edited = renderToRgba(doc, source);
```

Integer crop rounding retains the whole tiny synthetic; real fixtures undergo crop plus resize plus tone. The source [kernel](../packages/image-editor/src/core/pipeline.ts), [resampler](../packages/image-editor/src/core/resample.ts), and [tone implementation](../packages/image-editor/src/core/tone.ts) are the reproduction source, pinned to the measured Git SHA above.

## Decode results

All quantities in the following tables are **measured**, except explicitly estimated source-plus-frame accounting. Times in ms and memory in MiB show median [minimum–maximum] for five repetitions.

| Fixture | Dimensions; frames | Raw GCE delays (cs, unique) | API duration vs source | Direct repetitionCount | Synthetic pixel test | Decode ms median [range] |
|---|---|---|---|---|---|---|
| synthetic-disposal-methods | 4×3; 4 | 0/1/2/3 | All exact | 0 | All RGBA exact | 0.70 [0.60–0.80] |
| synthetic-fixed-loop | 3×2; 3 | 0/1/2 | All exact | 3 | All RGBA exact | 0.60 [0.50–2.10] |
| synthetic-infinite-loop | 2×2; 2 | 0/2 | All exact | Infinity | All RGBA exact | 0.60 [0.50–0.70] |
| synthetic-transparent-pixels | 3×2; 1 | 1 | All exact | Infinity | All RGBA exact | 0.30 [0.30–0.40] |
| real-high-frame-parallax | 200×150; 119 | 4 | All exact | Infinity | No pixel oracle | 30.30 [29.70–38.30] |
| real-photographic-dithered | 571×692; 219 | 8/9 | All exact | Infinity | No pixel oracle | 212.90 [210.70–214.90] |
| real-large-canvas | 1000×1000; 10 | 5 | All exact | Infinity | No pixel oracle | 34.30 [32.20–36.70] |

Measured: 358/358 frames complete, correct logical-screen dimensions, duration equal to raw delayCs × 10,000µs, and timestamp equal to cumulative preceding durations. No ImageDecoder delay clamping occurred: 0cs→0µs, 1cs→10,000µs, 2cs→20,000µs. This tests API metadata, not visible HTML img playback scheduling; it does not refute short-delay playback clamping in an image element.

Measured: all 320 RGBA bytes across ten synthetic frames match, including 8 transparent pixel occurrences. Disposal fixture transparent counts by frame are 0/0/1/2; infinite-loop fixture 2/0; transparent-pixels fixture 3. Thus alpha is demonstrated from pixels, not format strings. The fixed-loop synthetic has no transparent output pixels despite source transparent indices: those source pixels leave the underlying opaque composition untouched.

Measured animated loops: source repeat3→API3 (four total plays), source repeat0→API Infinity, absent extension in the animated disposal fixture→API0 (one play). Infinity remains a number in the page; JSON.stringify gives the string `null`. **Single-frame exception:** transparent-pixels has no loop extension and animated=true, and API repetitionCount is Infinity. It is harmless to still-image appearance but cannot recover that source metadata. The animated flag alone therefore does not identify this exception; retain source metadata or explicitly handle a one-frame input before mapping Infinity back to a loop extension.

Measured memory, MiB = 1,048,576 bytes. RSS and JS columns are five-run medians [min–max] of sampled run peaks; they are neither additive nor mutually exclusive.

| Fixture | Process-tree RSS MiB (measured) | JS heap MiB (measured) | Source + one output-frame bytes (estimated accounting) |
|---|---|---|---|
| synthetic-disposal-methods | 394.86 [394.80–394.92] | 2.90 [2.88–2.92] | 177 |
| synthetic-fixed-loop | 395.22 [395.15–395.29] | 3.07 [3.05–3.10] | 144 |
| synthetic-infinite-loop | 395.56 [395.49–395.63] | 3.22 [3.20–3.24] | 111 |
| synthetic-transparent-pixels | 395.77 [395.74–395.85] | 3.34 [3.32–3.36] | 77 |
| real-high-frame-parallax | 445.65 [441.32–476.45] | 4.20 [2.75–27.86] | 840,294 |
| real-photographic-dithered | 854.33 [851.90–856.22] | 6.96 [5.97–7.96] | 2,039,342 |
| real-large-canvas | 902.11 [901.18–904.26] | 3.01 [2.34–3.68] | 4,340,105 |

## No-edit output comparison

All table quantities **measured**; encode time and sampled memory are five-run median [minimum–maximum]. GIF output is **unoptimized**, full-frame. These are encode-only results after eager preparation, not full conversion costs.

| Fixture | Candidate | Original bytes | Output bytes | Output/original | Encode ms | RSS MiB | JS MiB | 25MiB |
|---|---|---:|---:|---:|---|---|---|---|
| real-high-frame-parallax | GIF (unoptimized) | 720294 | 762337 | 1.06× | 194.50 [190.30–195.80] | 442.29 [434.85–445.59] | 26.29 [21.12–29.28] | within |
| real-high-frame-parallax | APNG (full-frame) | 720294 | 1921933 | 2.67× | 320.30 [308.30–363.60] | 501.06 [495.80–511.92] | 42.89 [36.75–49.36] | within |
| real-high-frame-parallax | Still PNG (frame 0) | 720294 | 15145 | 0.02× | 1.80 [1.50–1.90] | 524.40 [524.14–524.70] | 38.60 [38.57–38.64] | within |
| real-photographic-dithered | GIF (unoptimized) | 458814 | 24820564 | 54.10× | 4528.50 [4489.60–4542.10] | 1224.55 [1185.77–1224.77] | 435.50 [428.36–435.91] | within |
| real-photographic-dithered | APNG (full-frame) | 458814 | 20590228 | 44.88× | 2140.30 [2104.30–2202.00] | 1305.13 [1303.95–1327.28] | 420.51 [420.50–422.13] | within |
| real-photographic-dithered | Still PNG (frame 0) | 458814 | 141057 | 0.31× | 5.70 [5.50–6.10] | 1288.29 [1285.12–1291.89] | 411.77 [411.49–412.05] | within |
| real-large-canvas | GIF (unoptimized) | 340105 | 476377 | 1.40× | 429.00 [418.20–493.20] | 949.88 [940.30–1359.33] | 108.73 [87.51–462.02] | within |
| real-large-canvas | APNG (full-frame) | 340105 | 1774732 | 5.22× | 180.40 [176.20–192.40] | 973.41 [958.35–976.83] | 66.64 [56.02–68.55] | within |
| real-large-canvas | Still PNG (frame 0) | 340105 | 162668 | 0.48× | 10.00 [8.40–10.70] | 956.80 [948.52–969.20] | 40.77 [40.44–60.89] | within |

All seven fixtures × three candidates × five repetitions completed. Browser decoding and independent Pillow decoding matched every original RGBA channel for GIF/APNG and selected frame 0 for PNG. No source frame needed quantization in this no-edit corpus, even the photographic one. This does not prove edited-color fidelity. Chromium enumerated all APNG frames (119/219/10 for the real sources), contrary to the planning caveat that this might be unsupported. All outputs were below 25MiB; photographic unoptimized GIF was 24,820,564 bytes, about 54× the original and only 1,393,836 bytes below the ceiling.

The slow GIF/APNG img control visibly changed from transparent frame 0 to frame 1, repeated, then remained on its last frame after two plays. Original real-file first-frame crops had zero channel differences across all nine candidate comparisons; manager inspection of photographic and large-canvas panels found no visible additional degradation. These limited screenshots do not prove entire real-file playback cycles or exact 0/1cs presentation timing. Sparse short-delay captures differed in phase and cannot distinguish scheduling differences from sequential screenshot timing.

## Actual edit results and resource envelope

All table values in the next tables are **measured**. Timing and memory columns show median (minimum–maximum) over five repetitions. Small/medium/large refer to source aggregate pixel workload: parallax 3.57 MP; logo 10 MP; photographic 86.53 MP (rounded). The largest individual canvas is the logo 1000×1000; largest sequence is photo 219×571×692. The 40 MP guard applies to each image, not those aggregate figures.

| Fixture / source frames × dimensions → edited dimensions | Strategy | Total ms | Decode ms | Edit ms | Encode ms | Finish ms | Browser RSS MiB | Sampled JS heap MiB |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| synthetic-transparent-pixels: 1×3×2 → 7×5 | eager | 8.70 (8.30–9.30) | 1.00 (0.80–1.30) | 6.20 (6.10–6.70) | 0.40 (0.40–0.50) | 0.00 (0.00–0.00) | 398.44 (395.39–398.58) | 2.68 (2.38–2.70) |
| synthetic-transparent-pixels: 1×3×2 → 7×5 | sequential | 8.40 (8.30–8.90) | 0.90 (0.80–1.30) | 6.20 (5.90–6.40) | 0.50 (0.40–0.60) | 0.10 (0.00–0.10) | 398.29 (397.92–398.63) | 2.00 (1.99–2.69) |
| real-high-frame-parallax: 119×200×150 → 126×95 | eager | 1030.10 (1022.10–1034.40) | 54.00 (52.00–55.90) | 406.30 (397.10–414.50) | 554.30 (546.70–564.50) | 0.50 (0.50–0.60) | 480.82 (480.26–482.93) | 58.20 (57.57–59.21) |
| real-high-frame-parallax: 119×200×150 → 126×95 | sequential | 1116.60 (1097.80–1134.70) | 70.20 (67.70–71.90) | 438.40 (421.60–444.50) | 602.30 (598.10–622.80) | 0.50 (0.40–0.50) | 462.02 (461.16–464.49) | 44.84 (42.88–45.30) |
| real-photographic-dithered: 219×571×692 → 360×436 | eager | 16366.00 (16241.10–16887.10) | 968.20 (938.30–1002.10) | 7824.90 (7779.30–7966.90) | 7525.70 (7454.20–7903.40) | 8.40 (8.40–9.50) | 1348.21 (1342.52–1361.80) | 592.26 (590.09–599.10) |
| real-photographic-dithered: 219×571×692 → 360×436 | sequential | 18535.30 (18138.60–18860.90) | 1197.70 (1186.10–1225.10) | 9323.40 (9185.10–9556.80) | 7967.20 (7737.80–8052.50) | 8.80 (8.40–9.30) | 843.09 (842.61–846.74) | 137.87 (80.88–143.81) |
| real-large-canvas: 10×1000×1000 → 630×630 | eager | 1306.80 (1287.60–1322.90) | 93.50 (92.90–99.90) | 983.50 (969.20–1003.80) | 219.70 (215.40–235.10) | 0.30 (0.20–0.40) | 527.27 (525.66–528.33) | 84.78 (83.66–85.52) |
| real-large-canvas: 10×1000×1000 → 630×630 | sequential | 1362.80 (1356.60–1420.70) | 102.80 (102.00–105.60) | 988.20 (984.00–1032.30) | 271.00 (266.70–285.80) | 0.20 (0.10–0.30) | 495.46 (495.36–497.95) | 47.28 (47.10–47.64) |
| Fixture | Unoptimized output bytes, min–max across both strategies | Largest encoded frame bytes | Quantized frames per run | Eager held source + edited RGBA MiB | Sequential held source + edited RGBA MiB |
|---|---:|---:|---:|---:|---:|
| synthetic-transparent-pixels | 57–57 | 37 | 0–0 | 0.000 | 0.000 |
| real-high-frame-parallax | 526004–526004 | 5395 | 119–119 | 19.052 | 0.160 |
| real-photographic-dithered | 15435965–15435965 | 80505 | 219–219 | 461.228 | 2.106 |
| real-large-canvas | 210849–210849 | 30200 | 10–10 | 53.288 | 5.329 |

The tiny synthetic retains 164 source+edited RGBA bytes in either strategy; the MiB table rounds this to 0.000.

Measured output quality below covers one separate sequential pass per fixture, outside timings. Byte-size consistency across eager/sequential repetitions is checked above; no cryptographic byte-identity claim is made. Error uses byte-channel scale 0–255. RGBA MAE includes invisible RGB and is supplemented by black/white compositing and opaque-pixel RGB MAE. Partial-alpha counts come from edited pre-encode RGBA; alpha mismatches are against decoded output. This compares encoding damage against the actual kernel output; it is not an independent oracle proving the kernel itself is free of premultiplication bugs. It tests palette/alpha damage after resampling and tone, unlike G2b's unchanged-fixture exact palette paths.

| Fixture | Verified frames | RGBA MAE | RGB MAE on black | RGB MAE on white | Opaque RGB MAE | Partial-alpha edited pixels | Alpha mismatch pixels | Maximum channel error |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| synthetic-transparent-pixels | 1 | 43.2786 | 25.7669 | 24.7759 | 0.0000 | 25 | 25 | 255 |
| real-high-frame-parallax | 119 | 0.4202 | 0.5602 | 0.5602 | 0.5602 | 0 | 0 | 27 |
| real-photographic-dithered | 219 | 1.4299 | 1.9066 | 1.9066 | 1.9066 | 0 | 0 | 53 |
| real-large-canvas | 10 | 0.0292 | 0.0390 | 0.0390 | 0.0390 | 0 | 0 | 7 |

### Resource envelope — estimated, conditional, not a measured hard maximum

Code-defined constants, read at the cited HEAD: MAX_DECODED_PIXELS=40,000,000 per image; MAX_WORKING_BYTES=512MiB; MAX_ENCODED_BYTES=25MiB. The GIF writer additionally restricts each output axis to 1..65535. validateEditDoc validates source and output sizes separately, and renderSteps validates crop size. The pipeline's existing guard is exactly:

~~~text
P = 4S + 12C + 12O + 256max(cropWidth, outputWidth) + 8MiB ≤ 512MiB
~~~

S,C,O are source, integer-rounded crop, and output pixel counts. Define T=P−4S. Its scratch terms budget geometry, resampling/area intermediates, output/tone copies, row scratch, and resident preview. The guard does not know N other sources, N edited results, compressed input, animation writer, or decoder-native state. A loop around renderToRgba therefore does not enforce an aggregate limit. The current per-render guard therefore accepts the 219-frame eager benchmark although it exceeds the 140-frame example aggregate policy below: each invocation sees only one source and its scratch, not already-retained frames. This prototype does not add an aggregate guard. Successful execution is not proof of aggregate enforcement. The existing still encode.ts checks 25 MiB after encoding; the prototype GIF writer is outside that guard and reports oversize output instead of asserting product support.

A conservative additive estimated accounting envelope for the precise retention strategies tested is:

- Eager: 4N(S+O) + T + I + 2B + H ≤ 512MiB.
- Sequential: 4(S+O) + T + I + 2B + H ≤ 512MiB.

I is retained compressed source input; B is the complete encoded animation, including frame tables/control blocks. 2B covers retained compressed chunks plus final contiguous finish allocation. T intentionally double-counts some edited output already in the residency term; this is a conservative accounting budget, not an allocation trace. H must cover all additional simultaneous memory: quantizer indices/outputWidth×outputHeight, its four 32768-entry Float64 histogram arrays (1MiB typed data), palette/color/box JS objects, LZW dictionary, the dynamically growing JS number[] of compressed bytes (engine-dependent backing overhead), its Uint8Array copy and framed copy, canvas backing, native VideoFrame/decoder state including any retained frame cache, runtime/allocator overhead, and allocations not reclaimed promptly. Crucially, H may depend on N despite sequential JS source release. No measurement here proves a uniform native bound.

For an explicit **estimated conditional** example, assume I≤25MiB, B≤25MiB, and H≤128MiB at every instant. The 128 MiB residual is an arbitrary engineering assumption requiring future validation/enforcement, not a measured safety margin, shipping recommendation, or promise. The lowest measured browser-process-tree baseline RSS in this run was 387.12 MiB, so this 128 MiB example must not be represented as a validated total-browser RSS reserve; baseline, shared-page accounting and native retention already invalidate that inference. Under these hypothetical assumptions (and the configured crop/resize above), the following integer maxima follow from the formula above:

| Source dimensions | Output dimensions | Estimated eager maximum N from memory | Estimated sequential memory admissible? |
|---|---|---:|---|
| 200×150 | 126×95 | 1877 | Yes, N additionally constrained by encoded size and H |
| 800×600 | 504×378 | 115 | Yes, N additionally constrained by encoded size and H |
| 571×692 | 360×436 | 140 | Yes, N additionally constrained by encoded size and H |
| 1000×1000 | 630×630 | 53 | Yes, N additionally constrained by encoded size and H |
| 3000×3000 | 1890×1890 | 3 | Yes, N additionally constrained by encoded size and H |
| 4000×4000 | 2520×2520 | 0 | No |

Estimated maximum square source in this particular edit/reserve example is 3958×3958, resized to 2494×2494, for one eager frame or sequential processing provided H stays bounded; 3959×3959 fails this example's aggregate envelope. This is not a universal maximum GIF. Different aspect ratios, crop and resize change T, and source 40 MP can be admissible for a small crop even when a full-frame edit is not.

Encoded size supplies a separate concrete frame ceiling. For this writer's looping outputs, header+loop+trailer is 39 bytes. If every future encoded frame is no larger than a measured worst-frame q for a fixture, then N_size=floor((25MiB−39)/q). This is a **conditional estimated extrapolation**, not proof that different frames or edits compress that well. Overall N_max is min(N_memory,N_size) for eager; sequential uses N_size only when the per-frame envelope and H(N) bound hold. Without a frame-compression/native-memory assumption neither strategy has one defensible universal maximum.

| Fixture content/edit class | Measured worst q bytes | Estimated conditional N_size under 25 MiB | Estimated eager N_max with same dimensions and above reserve | Estimated sequential N_max if H remains bounded |
|---|---:|---:|---:|---:|
| real-high-frame-parallax | 5395 | 4859 | 1877 | 4859 |
| real-photographic-dithered | 80505 | 325 | 140 | 325 |
| real-large-canvas | 30200 | 868 | 53 | 868 |

Largest measured sequence remains 219×571×692 source → 219×360×436 edited (photographic), not the estimated hypothetical maxima above. Its eager resident RGBA alone is about 461 MiB; sequential explicitly retains about 2.106 MiB for source+edited frame. A successful run beyond the example's 140-frame eager ceiling would not refute that conservative policy: real I/B are smaller and H is not fixed/measured. Conversely, success does not prove 512 MiB safety. See measured RSS rather than treating typed-buffer accounting as RSS.

### Architecture cost of rejected all-frame editing (not planned)

- core/types.ts: retain RgbaImage as a per-frame primitive. Add an animation source/metadata contract carrying logical canvas size, frame count, durations/timestamps, loop semantics, and a bounded frame provider with explicit release/close, rather than simply changing data into an eagerly allocated array. EditDoc can remain one shared geometric/tone transform for all frames; an enclosing animation edit job binds it to source identity and frame scope. Animated output format must be explicit; EditableMime currently names only still PNG/JPEG/WebP.
- core/pipeline.ts: preserve renderSteps/renderToRgba as the tested single-frame kernel and add an async coordinator decode→render→encode with backpressure, cancellation between frames and at render generator yields, progress, per-frame timing preservation, size checks, and deterministic cleanup. A whole-array return would recreate eager residency. Own an aggregate budget around source handoff, decoder/canvas, current render, writer chunks and finish, or adopt a bounded synchronous output sink with a separately designed asynchronous backpressure interface. Limits.ts needs aggregate job accounting plus early cumulative encoded-size checks; merely raising per-image 40 MP is unrelated.
- worker/client.ts and worker-core.ts: registration currently clones/transfers one RGBA and accounts for its replacement overlap; worker state owns one image and one preview cache. Register a compressed animation/frame-provider descriptor and metadata instead, preserve sourceId/incarnation identity, and account for old/new decoder and in-flight replacement overlap. Requests/results need frame index/time, export progress and cancellation; an export should return a bounded encoded result or stream rather than N RGBA messages.
- Supersede/preview: keep latest-wins preview generation, but make the cache key include frame index/time as well as incarnation and geometry. Bound preview frames/cache; do not render every animation frame on every tone slider event. Stale asynchronous decoder/encoder completions must match source incarnation and generation before delivery. Existing cancelPreviews settles/requeues client promises but cannot by itself abort an entire native decode/export; add cooperative cancellation/close for the animation coordinator. Full export uses a captured EditDoc snapshot with explicit cancellation policy; do not silently alter remaining frames when a new preview supersedes an older preview. Source replacement/release/dispose must terminate and release active frame/provider/writer resources.

## Alternatives and remaining evidence gaps

- **B, explicit still PNG conversion:** technically simpler than all-frame editing and viable in the no-edit prototype, but also excluded. Estimated integration work was 400–800 production LOC plus 300–600 test LOC. It would add a conversion/acknowledgment flow, source lifecycle management and edited-PNG validation. The product owner does not prioritize that feature; no follow-up implementation is scheduled.
- **A, all-frame GIF editing:** technically viable within the tested corpus, excluded from the product scope. G3 demonstrates edited color/alpha damage and significant long-sequence resource costs above. G1 disposal instructions/patches are unavailable from the decoder API; G2a's full-frame disposal-2 replacement preserves tested composited appearance while discarding those instructions. G2b's exact no-edit output does not prove edited fidelity. Optimized diff/disposal encoding might reduce size; it was deliberately not built and is not disproven. Production A would still require bounded frame-provider ownership, progress/cancellation, superseded preview handling, aggregate accounting and cumulative encoded-size enforcement. These maintenance requirements, rather than a fabricated benchmark failure, decide the rejection.
- **APNG conversion:** viable measured animation alternative, excluded on product scope. G2b exactly recovered all pixels, raw animated durations and loops; browser screenshots showed a slow control moving, clearing alpha and stopping after two plays. Real no-edit encode medians were 320.30 [308.30–363.60], 2,140.30 [2,104.30–2,202.00], and 180.40 [176.20–192.40] ms; outputs 1,921,933 / 20,590,228 / 1,774,732 bytes, all within 25 MiB. It avoids handwritten compression, with GD estimating 250–500 prototype LOC for muxing. It still commits the product to all-frame coordination and a changed delivery format. Edited APNG, recipient upload compatibility and cross-browser/native resource bounds were not measured. These gaps are not negative measurements; this feasible candidate can be revisited if preserving animation becomes a product requirement.
- **Animated WebP conversion:** excluded on scope/maintenance grounds, not performance. GD establishes a plausible native-frame RIFF muxer, estimated 300–600 prototype LOC; no G2b/G3 timing, size, edited quality or playback measurements exist. Browser compression quality/lossless behavior and receiving-service acceptance cannot be promised. Measuring it now would not eliminate the animation lifecycle cost that supports exclusion.
- **WebM video export:** rejected for product fit. It changes an image asset into a video/player contract with alpha, looping and codec support questions. GD estimates 700–1,400 prototype LOC for minimal muxing/orchestration; no benchmark was taken. This is not a failed encode test.
- **MP4 video export:** separately rejected for the same consumer-model mismatch and additional container/codec scope. GD estimates 1,000–2,000 prototype LOC; no speed, size, alpha or browser playback result exists.
- **Third-party encoder:** rejected by the current editor's documented zero-dependency architecture, not by measured poor quality or a universal npm ban. GD found provider checks do not ban an unrelated encoder, and the conformance no-runtime-dependency assertion applies to component-contract. Nevertheless, installing a private editor-only dependency would not deliver it to external hosts because that manifest is not shipped. A root runtime dependency, assets, lockfile and installed-host encode proof would require deliberate architectural change. No library was selected or benchmarked; GD's 50–200 adapter LOC excludes library size. Do not weaken gates or vendor a library to conceal this cost.

## Evidence limits

No upstream task ended with an inconclusive timebox verdict. Completed measurements still have limits: exact short-delay presentation cadence, a universal native-memory bound, cross-browser support, malformed-input behavior and edited still-PNG fidelity are unproven. G2b's encode-only timings cannot establish an end-to-end B/A conversion-speed ratio; its eager source residency is not a dedicated still-workflow memory measurement. G3's conditional reserve is an assumption, not a shipping limit.

These gaps do not block the decision to exclude GIF editing and conversion. They are recorded to prevent the research from being mistaken for a production capability or an outstanding implementation checklist. No further GIF experiments or implementation epic are scheduled.

## Effort estimate for the rejected conversion option

**Engineering estimate, not measured LOC:** approximately **400–800 production LOC plus 300–600 test LOC** for the bounded frame-0 B path: explicit conversion/acknowledgment and asset metadata flow (150–300), secure-context decode/extraction and source lifecycle/limits (150–300), and integration/error/cleanup plumbing (100–200). This includes product integration beyond GD's estimated 30–100 prototype glue LOC. It excludes an arbitrary-frame scrubber, fallback GIF decoder, animation export, unrelated editor changes and elapsed-time promises. G1's fallback alone is estimated at 700–1,200 production plus 500–1,000 test LOC if later required.

This estimate records the cost considered in rejecting the feature. It is not a deferred work item. Any later reversal would require a new explicit product decision and a new implementation scope.

## Prototype implementation reference

The following two dependency-free modules are the exact assessment writer/muxer implementations. They are reference text for reproduction in a scratch harness, **not production modules**. Save the fences as `gif-writer.mjs` and `apng.mjs` outside the package. Do not import them into product code without a separate implementation/review.

Both consume full composited frames. The GIF writer reserves index 0 for transparency, handles up to 255 opaque colors exactly, otherwise uses weighted median-cut over a 5-bit histogram; it emits full-screen disposal 2, local palettes and GIF LZW with dictionary resets. Inter-frame rectangle/disposal optimization is deliberately absent. G2a independently checked synthetic round-trips and LZW width/reset boundaries, including a 256×512 pseudorandom full-container test with 34 clear codes. Production bounds, async backpressure and malformed-input hardening are not implied.

APNG validates native PNG headers/CRC and reuses compressed IDAT. It emits full-screen SOURCE blending/NONE disposal, rational centisecond delays, and total-play loop semantics. Native PNG frame headers must agree; mismatches are rejected instead of implementing compression. Node checks covered IDAT reuse, sequence, CRC, truncation, header mismatch, budget and lifecycle. The muxer uses a prototype 128MiB emergency byte cap, distinct from the product’s 25MiB ceiling; measurements compare final files with the latter explicitly. Neither prototype implements the product’s full limits contract.

### gif-writer.mjs

```js
// Assessment prototype: unoptimized full-frame GIF89a, no dependencies or Node imports.
const integer = (value, min, max, name) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be ${min}..${max}`);
  return value;
};
const word = n => [n & 255, n >>> 8];
const rgbKey = (data, i) => (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
const binKey = (data, i) => ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
function checkRgba(rgba) {
  if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || !rgba.length || rgba.length % 4) {
    throw new TypeError('rgba must be a nonempty Uint8Array or Uint8ClampedArray of RGBA bytes');
  }
}

/** Binary alpha: alpha < threshold becomes transparent black; others become opaque.
 * Always reserves palette index 0 for transparency, leaving 255 opaque colors.
 * Exact <=255-color path, otherwise weighted median-cut over a bounded 5-bit histogram.
 */
export function quantizeRgba(rgba, { alphaThreshold = 128 } = {}) {
  checkRgba(rgba);
  integer(alphaThreshold, 1, 255, 'alphaThreshold');
  const exact = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < alphaThreshold) continue;
    const key = rgbKey(rgba, i);
    if (!exact.has(key)) exact.set(key, exact.size + 1);
    if (exact.size > 255) break;
  }
  const indices = new Uint8Array(rgba.length / 4);
  if (exact.size <= 255) {
    const palette = [[0, 0, 0], ...Array.from(exact.keys(), key => [key >>> 16, (key >>> 8) & 255, key & 255])];
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] >= alphaThreshold) indices[i / 4] = exact.get(rgbKey(rgba, i));
    return { indices, palette, quantized: false };
  }
  const counts = new Float64Array(32768);
  const sums = [new Float64Array(32768), new Float64Array(32768), new Float64Array(32768)];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < alphaThreshold) continue;
    const key = binKey(rgba, i);
    counts[key]++;
    for (let c = 0; c < 3; c++) sums[c][key] += rgba[i + c];
  }
  const colors = [];
  for (let key = 0; key < counts.length; key++) if (counts[key]) colors.push({ key, count: counts[key], rgb: sums.map(s => s[key] / counts[key]) });
  function box(items) {
    const low = [255, 255, 255], high = [0, 0, 0];
    let count = 0;
    for (const color of items) {
      count += color.count;
      for (let c = 0; c < 3; c++) { low[c] = Math.min(low[c], color.rgb[c]); high[c] = Math.max(high[c], color.rgb[c]); }
    }
    const ranges = high.map((n, c) => n - low[c]);
    const axis = ranges.indexOf(Math.max(...ranges));
    return { items, count, axis, score: items.length > 1 ? ranges[axis] * count : -1 };
  }
  const boxes = [box(colors)];
  while (boxes.length < 255) {
    let best = 0;
    for (let i = 1; i < boxes.length; i++) if (boxes[i].score > boxes[best].score) best = i;
    const chosen = boxes[best];
    if (chosen.items.length < 2) break;
    chosen.items.sort((a, b) => a.rgb[chosen.axis] - b.rgb[chosen.axis] || a.key - b.key);
    let cut = 0, weight = 0;
    while (cut < chosen.items.length - 1 && weight < chosen.count / 2) weight += chosen.items[cut++].count;
    boxes.splice(best, 1, box(chosen.items.slice(0, cut)), box(chosen.items.slice(cut)));
  }
  const palette = [[0, 0, 0], ...boxes.map(b => [0, 1, 2].map(c => Math.round(b.items.reduce((sum, item) => sum + item.rgb[c] * item.count, 0) / b.count)))];
  const lookup = new Uint8Array(32768);
  for (const color of colors) {
    let best = 1, distance = Infinity;
    for (let p = 1; p < palette.length; p++) {
      const d = palette[p].reduce((sum, n, c) => sum + (n - color.rgb[c]) ** 2, 0);
      if (d < distance) { distance = d; best = p; }
    }
    lookup[color.key] = best;
  }
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] >= alphaThreshold) indices[i / 4] = lookup[binKey(rgba, i)];
  return { indices, palette, quantized: true };
}

/** GIF LZW. Width advances on the decoder's schedule, including before final EOI. */
export function encodeLzw(indices, minimumCodeSize) {
  integer(minimumCodeSize, 2, 8, 'minimumCodeSize');
  const clear = 1 << minimumCodeSize, end = clear + 1;
  if (!(indices instanceof Uint8Array) || !indices.length || indices.some(n => n >= clear)) throw new RangeError('invalid indexed pixels');
  let width = minimumCodeSize + 1, decoderNext = end + 1, previous = false;
  let bits = 0, bitCount = 0, next = end + 1;
  const bytes = [], dictionary = new Map();
  const stats = { clearCodes: 0, maxCodeSize: width, emittedCodes: 0 };
  function emit(code) {
    stats.emittedCodes++;
    stats.maxCodeSize = Math.max(stats.maxCodeSize, width);
    bits |= code << bitCount;
    bitCount += width;
    while (bitCount >= 8) { bytes.push(bits & 255); bits >>>= 8; bitCount -= 8; }
    if (code === clear) {
      stats.clearCodes++;
      width = minimumCodeSize + 1; decoderNext = end + 1; previous = false;
    } else if (code !== end) {
      if (previous && decoderNext < 4096) {
        decoderNext++;
        if (decoderNext === 1 << width && width < 12) width++;
      }
      previous = true;
    }
  }
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const symbol = indices[i], key = prefix * 256 + symbol;
    const found = dictionary.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) dictionary.set(key, next++);
    else { emit(clear); dictionary.clear(); next = end + 1; }
    prefix = symbol;
  }
  emit(prefix);
  emit(end);
  if (bitCount) bytes.push(bits & 255);
  return { data: Uint8Array.from(bytes), stats };
}

/** repetitionCount = repeats AFTER first play: 0 => no extension, Infinity => wire 0.
 * onChunk is optional and strictly synchronous. Sink mode retains no prior output.
 * appendFrame consumes RGBA synchronously; it does not retain the input or prior frames.
 */
export function createGifWriter({ width, height, repetitionCount = 0, alphaThreshold = 128, onChunk } = {}) {
  integer(width, 1, 65535, 'width'); integer(height, 1, 65535, 'height');
  integer(alphaThreshold, 1, 255, 'alphaThreshold');
  if (repetitionCount !== Infinity) integer(repetitionCount, 0, 65535, 'repetitionCount');
  if (onChunk !== undefined && typeof onChunk !== 'function') throw new TypeError('onChunk must be a function');
  const chunks = [];
  let byteLength = 0, frameCount = 0, finished = false, failed = false, emitting = false;
  function emit(chunk) {
    byteLength += chunk.length;
    if (!onChunk) { chunks.push(chunk); return; }
    emitting = true;
    try {
      const result = onChunk(chunk);
      if (result && typeof result.then === 'function') throw new TypeError('onChunk must be synchronous');
    } catch (error) { failed = true; throw error; }
    finally { emitting = false; }
  }
  function checkOpen() { if (finished || failed || emitting) throw new Error('writer is finished, failed, or inside its sink callback'); }
  // Two-entry global palette gives background index 0 a defined transparent slot.
  emit(Uint8Array.from([71, 73, 70, 56, 57, 97, ...word(width), ...word(height), 0xf0, 0, 0, 0, 0, 0, 0, 0, 0]));
  if (repetitionCount !== 0) emit(Uint8Array.from([0x21, 0xff, 11, ...new TextEncoder().encode('NETSCAPE2.0'), 3, 1, ...word(repetitionCount === Infinity ? 0 : repetitionCount), 0]));
  return {
    appendFrame({ rgba, delayCs = 0 } = {}) {
      checkOpen();
      checkRgba(rgba);
      if (rgba.length !== width * height * 4) throw new RangeError('frame must cover the full logical screen');
      integer(delayCs, 0, 65535, 'delayCs');
      const { indices, palette, quantized } = quantizeRgba(rgba, { alphaThreshold });
      const tableBits = Math.max(1, Math.ceil(Math.log2(palette.length)));
      const table = new Uint8Array((1 << tableBits) * 3);
      palette.forEach((color, index) => table.set(color, index * 3));
      const minimum = Math.max(2, tableBits);
      const compressed = encodeLzw(indices, minimum);
      // Always transparent index 0 + full-screen disposal 2, including opaque frames.
      const header = Uint8Array.from([0x21, 0xf9, 4, 9, ...word(delayCs), 0, 0, 0x2c, 0, 0, 0, 0, ...word(width), ...word(height), 0x80 | (tableBits - 1)]);
      const framed = new Uint8Array(header.length + table.length + 1 + compressed.data.length + Math.ceil(compressed.data.length / 255) + 1);
      let cursor = 0;
      framed.set(header, cursor); cursor += header.length;
      framed.set(table, cursor); cursor += table.length;
      framed[cursor++] = minimum;
      for (let i = 0; i < compressed.data.length; i += 255) {
        const part = compressed.data.subarray(i, i + 255);
        framed[cursor++] = part.length; framed.set(part, cursor); cursor += part.length;
      }
      framed[cursor] = 0;
      emit(framed); frameCount++;
      return { quantized, paletteEntries: palette.length, unoptimizedByteLength: framed.length, lzw: compressed.stats };
    },
    finish() {
      checkOpen();
      if (!frameCount) throw new Error('at least one frame is required');
      emit(Uint8Array.of(0x3b)); finished = true;
      if (onChunk) return undefined;
      const output = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
      chunks.length = 0;
      return output;
    },
    get byteLength() { return byteLength; },
    get frameCount() { return frameCount; },
  };
}

export function encodeGif({ frames, ...options }) {
  const writer = createGifWriter(options);
  for (const frame of frames) writer.appendFrame(frame);
  return writer.finish();
}
```

### apng.mjs

```js
// Bounded assessment muxer. Full canvas SOURCE/NONE frames, native PNG compression.
const signature = Uint8Array.of(137,80,78,71,13,10,26,10);
const eq = (a,b) => a.length===b.length && a.every((v,i)=>v===b[i]);
const u32 = n => Uint8Array.of(n>>>24,n>>>16,n>>>8,n);
const read32 = (b,i) => new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(i);
export function crc32(data) { let c=0xffffffff; for(const b of data) {c^=b;for(let k=0;k<8;k++) c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0; }
const join = parts => {const b=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let i=0;for(const p of parts){b.set(p,i);i+=p.length;}return b;};
export function chunk(type,data) {const body=join([new TextEncoder().encode(type),data]);return join([u32(data.length),body,u32(crc32(body))]);}
export function parsePng(bytes) {
 if(!(bytes instanceof Uint8Array)||!eq(bytes.subarray(0,8),signature)) throw Error('PNG signature');
 const chunks=[];let i=8,ended=false;
 while(i<bytes.length){if(i+12>bytes.length)throw Error('truncated PNG');const n=read32(bytes,i);if(n>bytes.length-i-12)throw Error('chunk length');const type=new TextDecoder().decode(bytes.subarray(i+4,i+8)),data=bytes.slice(i+8,i+8+n);if(crc32(bytes.subarray(i+4,i+8+n))!==read32(bytes,i+8+n))throw Error('CRC');chunks.push({type,data});i+=12+n;if(type==='IEND'){ended=true;break;}}
 if(!ended||i!==bytes.length||chunks[0]?.type!=='IHDR'||chunks[0].data.length!==13||chunks.filter(c=>c.type==='IHDR').length!==1||!chunks.some(c=>c.type==='IDAT')||chunks.at(-1).data.length)throw Error('PNG structure');
 // Deliberately accept only browser-generated RGB/RGBA, noninterlaced 8-bit PNG.
 const h=chunks[0].data;if(h[8]!==8||![2,6].includes(h[9])||h[10]||h[11]||h[12])throw Error('unsupported native PNG header');
 const allowed=new Set(['IHDR','IDAT','IEND','sRGB','gAMA','cHRM','iCCP','cICP','pHYs']);if(chunks.some(c=>!allowed.has(c.type)))throw Error('unsupported PNG chunk');
 let seenIdat=false,endedIdat=false;for(const c of chunks){if(c.type==='IDAT'){if(endedIdat)throw Error('noncontiguous IDAT');seenIdat=true;}else if(seenIdat)endedIdat=true;}
 return {header:h,shared:chunks.filter(c=>!['IHDR','IDAT','IEND'].includes(c.type)),idat:chunks.filter(c=>c.type==='IDAT').map(c=>c.data)};
}
export function createApngWriter({width,height,frameCount,totalPlays=0,maxBytes=128*1024*1024}={}) {
 for(const [name,n,max] of [['width',width,16384],['height',height,16384],['frameCount',frameCount,10000],['totalPlays',totalPlays,0xffffffff],['maxBytes',maxBytes,0x7fffffff]])if(!Number.isInteger(n)||n<(name==='totalPlays'?0:1)||n>max)throw Error(name);
 let count=0,sequence=0,header,shared,closed=false,failed=false,byteLength=0;const parts=[];
 const emit=b=>{if(byteLength+b.length>maxBytes)throw Error('APNG byte budget');parts.push(b);byteLength+=b.length;};
 return {
 appendFrame({png,delayCs=0}) {if(closed||failed)throw Error('writer closed');try {
 if(count>=frameCount||!Number.isInteger(delayCs)||delayCs<0||delayCs>65535)throw Error('frame count/delay');
 const p=parsePng(png);if(read32(p.header,0)!==width||read32(p.header,4)!==height)throw Error('dimensions');
 const metadata=join(p.shared.map(c=>chunk(c.type,c.data)));
 if(!count){header=p.header;shared=metadata;emit(signature);emit(chunk('IHDR',header));emit(metadata);emit(chunk('acTL',join([u32(frameCount),u32(totalPlays)])));}
 else if(!eq(header,p.header)||!eq(shared,metadata))throw Error('incompatible PNG shared headers');
 const f=join([u32(sequence++),u32(width),u32(height),u32(0),u32(0),Uint8Array.of(delayCs>>>8,delayCs,0,100,0,0)]);emit(chunk('fcTL',f));
 for(const data of p.idat)emit(chunk(count?'fdAT':'IDAT',count?join([u32(sequence++),data]):data));count++;
 }catch(e){failed=true;throw e;}},
 finish(){if(closed||failed||count!==frameCount)throw Error('incomplete/closed APNG');try{emit(chunk('IEND',new Uint8Array()));closed=true;const result=join(parts);parts.length=0;return result;}catch(e){failed=true;throw e;}},
 get byteLength(){return byteLength;},get frameCount(){return count;}
 };
}
```

For GIF pass source repeat3 as `repetitionCount: 3`, endless as `Infinity`, absent extension as 0. For APNG map to total plays (4, 0, 1 respectively). Do not infer source loop semantics from the single-frame ImageDecoder anomaly. Append source GCE `delayCs` to each frame. For native PNG use `putImageData`, `convertToBlob({type:"image/png"})`, verify returned MIME, then read bytes. `finish()` includes final assembly in the timed interval. Keep decoder, edit and encoding stages separate when reproducing the tables; their totals cannot be substituted for one another.

The dialog regression test asserts no fetch, no decode and no editor mount for GIF. The warning says “GIF editing is not supported,” without promising future support. No conversion flow or animation editor is planned.
