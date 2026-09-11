# ML upscaling assessment

**Decision: not now.** ML-assisted upscaling does not earn a dependency in
zudo-composer at this time. No ML runtime or model ships; Lanczos3 in
`packages/image-editor/src/core/resample.ts` remains the only enlargement
path; no implementation issue is scheduled.

Both measured candidates were rejected on their own evidence: UpscalerJS
ESRGAN Slim scored below Lanczos3 on every PSNR row measured, and Swin2SR
classical SR was mixed on quality, about 180–215× slower than Lanczos3 at 2×, 77
MB per scale, and had a model-load memory footprint within about 20 MiB of
the 512 MiB budget that crossed it once and killed the browser. The measuring
machine was not quiet during timed runs and WebGPU/multi-thread WASM were
unavailable, so neither candidate's evidence is conclusive — the epic's rule
for inconclusive evidence is "not now." This is "not now," not a permanent
exclusion; see [What would reopen it](#what-would-reopen-it) below.

## Scope and provenance

This assessment answers [#443](https://github.com/Takazudo/zudo-composer/issues/443)
through epic [#471](https://github.com/Takazudo/zudo-composer/issues/471) and
its sub-issues [#478](https://github.com/Takazudo/zudo-composer/issues/478)–[#484](https://github.com/Takazudo/zudo-composer/issues/484).
Repository measured at `eaa3576d4998d03d591362a1cbfa78ee6e325235`; assessment
dates 2026-09-10/11 (UTC). The resampling kernel is
`packages/image-editor/src/core/resample.ts`, SHA-256
`0f590bf5466603a9d797825d11cbb0f26971e7042d9a10e5287a5a5a41cfd53d`. The
editor's current limits are `MAX_DECODED_PIXELS` 40,000,000 pixels and
`MAX_WORKING_BYTES` 512 MiB.

All prototype assets — the fixture corpus, harness, adapters, benchmark runs
and crops — were produced outside this repository, stayed outside it, and are
not committed here. This document is self-contained: no prototype directory
or epic issue is required to read it.

## Fixture corpus

Six reference crops were taken from photographs on Wikimedia Commons. Each
reference is a direct 512×512 pixel crop from the original (no pre-resize or
interpolation); each input is the repository's own exact-area reduction of
that reference (2× input: one repository pass 512→256; 4× input: the
repository's staged reduction 512→256→128). Scores in this document therefore
measure how well a method inverts this pipeline, not real-world upscaling of
an independently low-resolution photo — see the realistic photo below for a
visual-only complement.

| ID | Coverage | Source | Author / license | Original dimensions / bytes | Original SHA-256 | Feature region (reference coordinates) |
| --- | --- | --- | --- | --- | --- | --- |
| portrait | portrait / skin | [Commons page](https://commons.wikimedia.org/wiki/File:Bihter_Karal_portrait_(_2022_).jpg) | Göksu Başaran; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | 1080×1484 / 89,504 bytes | `6841b7f0f82aae82e70b8be6e2e8675a53b7f19936886b2ba742e1c1199dd331` | x=140, y=140, w=236, h=220 — eyes and cheek skin texture |
| foliage | foliage / fine texture | [Commons page](https://commons.wikimedia.org/wiki/File:Dendrocnide_moroides_foliage_SF20326.jpg) | Steve Fitzgerald; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | 1536×2048 / 2,480,624 bytes | `bea34a83cb5a6a938346f3afa348f5e5d2d55f146a1aa93d4effac1880613269` | x=24, y=36, w=448, h=440 — central leaf veins and serrated edge |
| text | text / signage | [Commons page](https://commons.wikimedia.org/wiki/File:Anerley_station_signage_2010.JPG) | Sunil060902; [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) | 2592×1944 / 1,268,386 bytes | `07eddd9f59a370cd90360e2dc3c0a6878d0ca59e5ceb154dd5dac68e912c3c44` | x=0, y=0, w=512, h=336 — Anerley station lettering and sign edges |
| lowlight | low-light noise | [Commons page](https://commons.wikimedia.org/wiki/File:2016-01-03_Street_in_Bad_Mergentheim_at_night_(134729113).jpg) | Cyprian Trentin Meyer; [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) | 2048×1365 / 512,394 bytes | `5120eefe6f269e90ca84cccae8f01c42e541dfdbad93a3012fc33c48f9396a94` | x=100, y=76, w=316, h=288 — lamp halo against shadowed tree line |
| architecture | architecture / straight edges | [Commons page](https://commons.wikimedia.org/wiki/File:Facade_of_Shahji_Temple_architecture.jpg) | Aliva Sahoo; [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) | 4096×3072 / 5,553,804 bytes | `9cf4d185a84bd8ff2cf4ca17543839d84e7b52a7c4f706ac3e53895c8d6f87df` | x=24, y=104, w=464, h=336 — facade ledges and carved stone edges |
| alpha | alpha PNG cutout | [Commons page](https://commons.wikimedia.org/wiki/File:Citrus_paradisi_(Grapefruit,_pink)_transparent_bg.png) | Original photograph by א (Aleph), derivative by ReneeWrites; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) | 2800×1600 / 5,410,327 bytes | `3f3892c16c3485c6cbf963039fb9028205f221b060baa566d61828880c76587b` | x=0, y=0, w=512, h=512 — grapefruit top silhouette edge and translucent pulp |

Two additional inputs have no ground-truth reference:

- The **2048² stress input** is a direct 2048×2048 crop from the architecture
  original, 4,719,305 bytes, SHA-256
  `9d6283c2f269f1a0a39786a228f2468942fe2d5ac5fe94a6e3777a3d679e62ae`. It
  exercises memory/time behavior separately from the compact reference crops.
- The **realistic photo** is a native 202×258 JPEG, 21,327 bytes, SHA-256
  `5736512774b0151b10de8f126a315fc50344e3d85fda1937b4b3448d80fb6f1b` — the
  direct original Commons file, not a downscaled thumbnail. It has no ground
  truth and is judged visually only.

## Candidates and licenses

Two families were shortlisted from a wider desk review, each with exact
pinned artifacts and both weight and runtime licenses traced to their own
LICENSE files:

| Candidate | Weights license | Runtime license | Native scales |
| --- | --- | --- | --- |
| UpscalerJS ESRGAN Slim (`@upscalerjs/esrgan-slim@1.0.0`) | [MIT](https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-slim@1.0.0/LICENSE) | wrapper `upscaler@1.0.0` [MIT](https://cdn.jsdelivr.net/npm/upscaler@1.0.0/LICENSE); `@tensorflow/tfjs@4.11.0` [Apache-2.0](https://github.com/tensorflow/tfjs/blob/tfjs-v4.11.0/LICENSE) | native 2×, native 4× |
| Swin2SR classical SR via Transformers.js (`Xenova/swin2SR-classical-sr-{x2,x4}-64`, fp32) | [Apache-2.0, traced upstream](https://github.com/mv-lab/swin2sr/blob/6f25d7689813f7dd12c5a212b638066fa71bc9e6/LICENSE) | `@huggingface/transformers@3.7.2` [Apache-2.0](https://github.com/huggingface/transformers.js/blob/28852a2ad92e9bf410af11fe03e2b8b51e96c0d6/LICENSE); bundled ONNX Runtime `1.22.0-dev.20250409-89f8206ba4` [MIT](https://github.com/microsoft/onnxruntime/blob/89f8206ba4/LICENSE) | native 2×, native 4× |

Swin2SR's conversion-tool revision is not recorded by the Hugging Face model
cards; the pin is to the converted artifact and its publisher SHA-256, not to
a reproducible conversion.

Five other candidates were surveyed but not run — research deferrals, not
measurements: **Real-ESRGAN x4plus / x4plus-anime / general-x4v3** (BSD-3
weights) had no per-file provenance for a browser-runnable ONNX conversion
traced back to the official checkpoint; **FSRCNN** and **ESPCN** (Apache-2.0
weights) ship only frozen TensorFlow graphs with no verified pinned browser
(ONNX/tfjs) conversion. All five would need fresh, provenance-verified
conversion work before they could be measured.

Download size (file payload bytes, not compressed HTTP transfer):

| Candidate | Runtime bytes | Model bytes (per scale) | Total (per scale) |
| --- | ---: | ---: | ---: |
| ESRGAN Slim | 1,478,022 | x2 902,058 / x4 947,548 | 2,380,080 / 2,425,570 |
| Swin2SR | 22,512,306 (includes a 21,596,019-byte ORT WASM) | x2 54,429,676 / x4 55,021,161 | 76,941,982 / 77,533,467 |

## Method

**Machine (identifiers, not measurements):** AMD Ryzen 5 5600XT (6 cores / 12
threads), WSL2 kernel 6.6.114.1-microsoft-standard-WSL2, 11,961 MiB RAM
visible; Node 24.13.1; Playwright 1.62.1; HeadlessChrome 151.0.7922.34;
Pillow 12.2.0.

**Harness boundaries.** Wall time runs from just before `adapter.upscale`
through the awaited output, including preprocessing, tiling, inference,
readback and alpha handling — total upscaling time, not pure model compute.
Memory is Chromium process-tree VmRSS sampled every 25 ms (baseline /
absolute peak / delta); JS heap (`usedJSHeapSize`) is a separate boundary
sample. GPU device allocations and native allocation ownership are not
captured by either measure, and neither proves compliance with the 512 MiB
product budget.

**Backends actually used.** ESRGAN Slim ran on `tfjs-webgl`; Swin2SR ran on
single-thread `ort-wasm` (`numThreads: 1`, no proxy). `navigator.gpu` was
present but `requestAdapter()` returned no adapter in this HeadlessChrome, so
no WebGPU path was exercised, and the page was not cross-origin isolated, so
multi-threaded WASM was unavailable. Reporting `tfjs-webgl` as the backend
does not by itself prove hardware acceleration.

**Tiling policy (fixed before timed comparisons).** ESRGAN Slim: 64px core,
16px halo, align 1. Swin2SR: 32px core, 8px halo, align 8. Lanczos3 runs
whole-image, yielding cooperatively every 16 rows.

**Matrix.** Per candidate/scale pair: 1 discarded warmup inference, then 5
measured cached repetitions in one browser session. Separately, 6 cold
launches per candidate/scale (new Chromium process and context, cleared HTTP
cache, Cache API and IndexedDB, no adapter) — launch 1 discarded, launches
2–6 measured. One offline-after-load row per candidate (load online, then
`context.setOffline(true)` for inference). One 2048² stress run per
candidate/scale, stopped by a 512 MiB RSS-delta watchdog or a 30-minute
timeout, whichever comes first.

**Metrics.** RGB PSNR (range 255) and BT.601 grayscale 8×8-window,
stride-8 SSIM on opaque fixtures; the alpha fixture is scored after
compositing over both a light RGB(240,240,240) and a dark RGB(24,24,24)
background.

**Machine not quiet (measured).** Other sessions on the same machine ran
uncontrolled `vitest`, `tsc --noEmit` and `workerd` jobs during the timed
runs, and a separate project's Playwright run overlapped part of the Swin2SR
2× benchmark. The 1-minute load average ranged from about 1.3 to about 24
during the benchmark window. Outliers attributable to this contention are
called out below as estimated, not attributed to the candidate; the reported
medians otherwise stand.

**Round 1 / round 2.** The first benchmark round ran the harness from its
Dropbox-synced directory and failed partway through with `EACCES` on
`/mnt/c`, most likely a Dropbox file handle on a freshly written result
(estimated cause). Round 2 re-ran the identical, hash-verified harness from a
local ext4 mirror and is the source of every result below.

## Results

### Quality — PSNR dB / SSIM, Δ vs Lanczos3 (measured; each pair's 5 repetitions were bit-identical)

| Pair | Bg | Lanczos3 | ESRGAN Slim | Swin2SR |
| --- | --- | --- | --- | --- |
| portrait-2x | opaque | 49.40 / 0.9962 | 47.35 (−2.05) / 0.9951 (−0.0011) | 49.10 (−0.31) / 0.9964 (+0.0002) |
| foliage-2x | opaque | 30.08 / 0.8651 | 29.46 (−0.62) / 0.8403 (−0.0248) | 30.00 (−0.08) / 0.8821 (+0.0170) |
| text-2x | opaque | 37.22 / 0.9725 | 36.80 (−0.42) / 0.9708 (−0.0017) | 36.07 (−1.15) / 0.9733 (+0.0008) |
| lowlight-2x | opaque | 36.81 / 0.9157 | 36.38 (−0.43) / 0.9103 (−0.0054) | 36.68 (−0.13) / 0.9172 (+0.0015) |
| architecture-2x | opaque | 43.79 / 0.9826 | 42.40 (−1.38) / 0.9791 (−0.0035) | 43.93 (+0.15) / 0.9829 (+0.0003) |
| alpha-2x | light240 | 42.40 / 0.9828 | 40.22 (−2.18) / 0.9773 (−0.0055) | 41.16 (−1.24) / 0.9790 (−0.0038) |
| alpha-2x | dark24 | 39.81 / 0.9818 | 37.44 (−2.37) / 0.9767 (−0.0051) | 37.89 (−1.92) / 0.9808 (−0.0009) |
| portrait-4x | opaque | 42.52 / 0.9832 | 38.89 (−3.62) / 0.9675 (−0.0157) | 43.10 (+0.58) / 0.9843 (+0.0011) |
| foliage-4x | opaque | 26.02 / 0.6141 | 25.76 (−0.26) / 0.6060 (−0.0081) | 26.29 (+0.27) / 0.6652 (+0.0511) |
| text-4x | opaque | 30.91 / 0.9137 | 30.87 (−0.03) / 0.9145 (+0.0008) | 29.28 (−1.62) / 0.9123 (−0.0014) |
| lowlight-4x | opaque | 33.04 / 0.8376 | 32.92 (−0.12) / 0.8360 (−0.0016) | 32.20 (−0.84) / 0.8402 (+0.0026) |
| architecture-4x | opaque | 36.84 / 0.9356 | 36.33 (−0.51) / 0.9313 (−0.0043) | 36.88 (+0.04) / 0.9447 (+0.0091) |
| alpha-4x | light240 | 37.17 / 0.9455 | 34.62 (−2.55) / 0.9224 (−0.0231) | 35.44 (−1.73) / 0.9390 (−0.0066) |
| alpha-4x | dark24 | 34.42 / 0.9405 | 32.39 (−2.03) / 0.9262 (−0.0143) | 32.68 (−1.74) / 0.9462 (+0.0057) |

- ESRGAN Slim is below Lanczos3 in PSNR on all 14 rows, and in SSIM on 13 of
  14.
- Swin2SR has higher PSNR than Lanczos3 on 4 of 14 rows (+0.04 to +0.58 dB)
  and lower PSNR on 10 (down to −1.92 dB). SSIM is higher on 10 of 14, with
  the largest gain at foliage-4x (+0.051). PSNR drops most on text and on
  both alpha backgrounds.
- The alpha losses for both ML candidates are consistent with predicting RGB
  under transparent pixels as black while alpha is filtered separately
  (estimated interpretation, not isolated by a dedicated test).

### Time — ms per upscale (measured; median of 5 cached repetitions per pair)

| Candidate | Cached inference, range of per-pair medians | All measured reps | Warmup range |
| --- | --- | --- | --- |
| Lanczos3 2× / 4× (12 pairs) | 707–731 | 706–764 | 711–782 |
| ESRGAN Slim 2× | 15,171–19,268 | 14,938–24,753 | 14,985–18,135 |
| ESRGAN Slim 4× | 6,325–9,424 | 6,101–11,348 | 7,090–11,170 |
| Swin2SR 2× (excl. contaminated alpha-2x) | 133,209–153,060 | 129,783–162,786 | 131,450–153,313 |
| Swin2SR 4× | 35,738–39,204 | 33,378–51,804 | 33,351–49,441 |

At the 512² output size, compared with Lanczos3's cached medians (estimated
ratios): ESRGAN Slim is about 21–27× slower at 2× and about 9–13× slower at
4×; Swin2SR is about 180–215× slower at 2× (five uncontaminated pairs) and
about 50–55× slower at 4×.
Lanczos3's own time includes cooperative `setTimeout(0)` yields, so it is
scheduling-dominated rather than kernel-dominated.

A concurrent Playwright run from an unrelated project overlapped part of the
Swin2SR 2× benchmark, contaminating the Swin2SR 2× alpha-2x cell. Its posted
median of 172,601 ms (all reps 133,589–189,182 ms) reflects contention, not
the candidate, per the
[U1b timing correction](https://github.com/Takazudo/zudo-composer/issues/471#issuecomment-5640917482).
The Swin2SR 2× row above excludes that cell: per-pair medians over the
remaining five pairs are 133,209–153,060 ms, and all reps are
129,783–162,786 ms, giving the "about 180–215× slower" estimate above.
Quality, memory, download and offline results are unaffected (the alpha-2x
quality metrics were bit-identical across all 5 repetitions). The cell was
not re-run on a quiet machine.

### Cold vs cached (measured; 5 cold launches after 1 discarded)

| Candidate | Cold load ms | Cold first inference ms | Cached load ms (idempotent) | Cached inference ms (portrait median) |
| --- | --- | --- | --- | --- |
| Lanczos3 2× / 4× | 6 (5–7) / 6 (5–8) | 788 (780–872) / 846 (836–1,067) | ≈0 | 715 / 718 |
| ESRGAN Slim 2× | 436 (395–695) | 19,616 (17,421–35,698) | ≈0 | 16,112 |
| ESRGAN Slim 4× | 774 (390–797) | 14,999 (8,271–18,718) | ≈0 | 9,424 |
| Swin2SR 2× | 14,319 (11,129–18,111) | 142,502 (132,260–172,158) | ≈0 | 133,492 |
| Swin2SR 4× | 11,376 (11,206–11,598) | 35,023 (34,124–35,391) | ≈0 | 37,244 |

Cold load means download from the localhost harness plus runtime and model
init; it excludes real network latency and compression, which were not
measured.

### Memory (measured; MiB process-tree RSS, MB JS heap)

| Candidate | Load RSS Δ (cold, median (min–max)) | Load RSS peak | JS heap after load | Cold first-inference RSS Δ / peak | Cached inference RSS Δ (per-pair medians) |
| --- | --- | --- | --- | --- | --- |
| Lanczos3 | 0.9–1.0 | 445 | 1.6 | 27.1–28.1 / 475 | 0.0–1.2 |
| ESRGAN Slim 2× | 43.9 (43.6–44.7) | 488 | 10.3 | 162.8–168.4 / 653 | 0.0–0.9 |
| ESRGAN Slim 4× | 43.8 (43.4–44.3) | 484 | 10.4 | 428.9–435.9 / 918 | 1.0–3.7 |
| Swin2SR 2× | 492.2 (490.4–492.8); discarded launch 512.29 → killed | 932 | 61.4 | 105.6–115.9 / 967 | 10.6–15.2 |
| Swin2SR 4× | 491.7 (490.8–493.1) | 929 | 62.0 | 99.8–110.9 / 966 | 9.3–14.3 |

- Swin2SR's model load alone sits 17–22 MiB under the 512 MiB watchdog
  ceiling, and crossed it once (512.29 MiB) across 12 cold launches — model
  load makes Swin2SR non-deterministic against the product's own memory
  budget before any pixel is processed.
- ESRGAN Slim's 4× first inference allocates about 430 MiB RSS, 76–83 MiB
  below the ceiling (probably WebGL texture and program state; estimated).
  Cached repetitions reuse it.
- GPU device allocations and native allocation ownership are not captured by
  RSS.

### Stress — 2048² input (measured; single run, no warmup)

| Candidate | Case | Status | Wall ms | RSS baseline / peak / Δ MiB |
| --- | --- | --- | --- | --- |
| Lanczos3 | 2× → 4096² | ok | 44,225 | 464 / 574 / 110.2 |
| Lanczos3 | 4× → 8192² | `pixel-limit` rejected before allocation | — | 475 / 475 / 0.0 |
| ESRGAN Slim | 2× → 4096² | ok | 1,216,139 (20.3 min) | 502 / 725 / 223.2 |
| ESRGAN Slim | 4× → 8192² | `pixel-limit` rejected | — | 503 / 503 / 0.0 |
| Swin2SR | 2× → 4096² | timeout at 30 min stop | — (killed after 1,879 s) | 932 / 974 / 41.3 until kill |
| Swin2SR | 4× → 8192² | `pixel-limit` rejected | — | 932 / 932 / 0.0 |

Swin2SR 2× at 16 MP is estimated to need about 2.4 hours (64 × the 256²-input
work × ≈134 s).

## Crops

Six panels, each showing left→right `reference | Lanczos3 | ESRGAN Slim |
Swin2SR` (the realistic panel has no reference: `Lanczos3 | ESRGAN Slim |
Swin2SR`), cut at the fixture's named feature region. Transparent pixels in
the alpha panel keep their stored RGB (white in the reference, black in every
upscaler output) — judge alpha from the composited metrics above, not from
the crop's raw color.

![Portrait 4x panel: reference, Lanczos3, ESRGAN Slim, Swin2SR, showing eyes and cheek skin texture](https://github.com/Takazudo/zudo-composer/releases/download/_attachments/20260912_064224-1-portrait-4x-panel-reference-lanczos-slim-x4-swin-x4.png)

Portrait, 4×, feature region eyes and cheek skin texture. Source: Göksu
Başaran, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0).

![Text 4x panel: reference, Lanczos3, ESRGAN Slim, Swin2SR, showing Anerley station lettering](https://github.com/Takazudo/zudo-composer/releases/download/_attachments/20260912_064224-2-text-4x-panel-reference-lanczos-slim-x4-swin-x4.png)

Text, 4×, feature region Anerley station lettering and sign edges. Source:
Sunil060902, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0).

![Foliage 4x panel: reference, Lanczos3, ESRGAN Slim, Swin2SR, showing leaf veins](https://github.com/Takazudo/zudo-composer/releases/download/_attachments/20260912_064224-3-foliage-4x-panel-reference-lanczos-slim-x4-swin-x4.png)

Foliage, 4×, feature region central leaf veins and serrated edge. Source:
Steve Fitzgerald, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0).

![Alpha 4x panel: reference, Lanczos3, ESRGAN Slim, Swin2SR, showing grapefruit silhouette edge](https://github.com/Takazudo/zudo-composer/releases/download/_attachments/20260912_064224-4-alpha-4x-panel-reference-lanczos-slim-x4-swin-x4.png)

Alpha, 4×, feature region grapefruit top silhouette edge and translucent
pulp. Source: photograph by א (Aleph), derivative by ReneeWrites, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0).

![Architecture 2x panel: reference, Lanczos3, ESRGAN Slim, Swin2SR, showing facade ledges](https://github.com/Takazudo/zudo-composer/releases/download/_attachments/20260912_064224-5-architecture-2x-panel-reference-lanczos-slim-x2-swin-x2.png)

Architecture, 2×, feature region facade ledges and carved stone edges.
Source: Aliva Sahoo, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0).

![Realistic 4x panel: Lanczos3, ESRGAN Slim, Swin2SR, showing native low-resolution facial silhouette](https://github.com/Takazudo/zudo-composer/releases/download/_attachments/20260912_064224-6-realistic-4x-panel-lanczos-slim-x4-swin-x4.png)

Realistic photo (native low resolution, no reference crop), 4×, feature
region native low-resolution facial silhouette. This is the direct original
Commons file, judged visually only. Visual impression, not measured: both ML
outputs look slightly crisper on the shirt check than Lanczos3, and ESRGAN
Slim adds blocky texture.

## Network and offline audit

All 51 benchmark browser launches contacted only the localhost harness; zero requests
occurred during inference, in every bench row and every offline row. Offline
after load succeeded for every candidate:

| Candidate / scale | Offline wall ms, portrait | Offline wall ms, realistic photo |
| --- | ---: | ---: |
| ESRGAN Slim 2× | 35,946 | 35,457 |
| ESRGAN Slim 4× | 15,912 | 35,125 |
| Swin2SR 2× | 168,789 | 142,792 |
| Swin2SR 4× | 34,447 | 150,055 |

Offline **cold start** (installing the model while offline) was not tested.
Third-party hosts (cdn.jsdelivr.net, huggingface.co) appear only in the
one-time download inventories, never during any browser load or inference.
Privacy was not the blocker for either candidate.

## Packaging reality

A shipped runtime would have to pass four gates, verified in source at the
measured SHA:

1. `scripts/check-package-conformance.mjs:213-218` — matches the packed
   editor source files exactly against disk, requires each in the root
   `files` whitelist, requires the private editor to stay a root
   `devDependencies['@zudo-composer/image-editor'] === 'workspace:*'`, and
   forbids it as a root runtime dependency or peer.
2. `scripts/check-dist-artifact.mjs:140-143` — asserts exactly one `.wasm`
   file in the built dist artifact (the existing focused Markdown-render
   WASM).
3. `corepack pnpm install --frozen-lockfile`.
4. `corepack pnpm smoke:host-install` — the only proof that packs the
   package and installs it into a project outside this repository.

Swin2SR's bundled ORT WASM is 21,596,019 bytes and would conflict directly
with the exactly-one-WASM assertion; shipping it would require a reviewed
architecture change to that gate, which this assessment does not authorize.

A model-cache policy (Cache API namespace keyed by model/runtime revision and
SHA-256, quota, eviction, invalidation, offline failure behavior) is a
separate, undecided future policy, distinct from
`scripts/check-headless-boundary.mjs`'s authored-data rule, which forbids
`localStorage`/`sessionStorage`/IndexedDB globals under the editor's
persistence roots but says nothing about a model cache elsewhere.

## Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| Yes — ship ESRGAN Slim as opt-in | Below Lanczos3 on every PSNR row and 13/14 SSIM rows while 9–27× slower. A root `dependencies` entry (tfjs 1,464,064 B runtime), an asynchronous worker stage, consent/progress/cancel UI and a model-cache policy would buy a worse image. |
| Yes — ship Swin2SR as opt-in | 77 MB per scale, ~134 s per 512² output on the measured path, model load consuming ~96% of the 512 MiB budget and killed once by the watchdog, 16 MP not achievable, and PSNR losses on text/alpha. Its SSIM gains (10/14) are the only positive signal and are inconclusive on their own. |
| Yes — ship Swin2SR but WebGPU/multi-thread only | Unmeasured on this machine (no WebGPU adapter, not cross-origin isolated). Shipping on an unmeasured path violates the epic's own rule; cross-origin isolation is also a host-project header change this tool cannot impose. |
| No — permanent exclusion (GIF precedent, [#468](https://github.com/Takazudo/zudo-composer/issues/468)) | GIF was closed on product scope. Here the measured candidate set is two families, both on degraded paths, with structural gains visible on 10/14 SSIM rows; the small-CNN family and the accelerated backends are untested, not failed. Closing permanently would overstate the evidence. |
| Lazy CDN-loaded runtime + weights, no npm dependency | Sidesteps the one-WASM dist assertion but not quality, speed or memory. Adds third-party code execution with origin privileges, CSP/CORS/offline-completeness policy and network metadata leakage. Not a fix for the measured problems. |
| Host-supplied optional model pack | Requires a new external package contract and absent/present-pack smoke gates; the editor's private workspace manifest cannot implement it. Deferred until a candidate is worth packaging. |
| Hosted/server-side upscaling | Out of scope: this repository claims no hosted API, persistence or authentication, and user images must never leave the machine. |
| Convert and run FSRCNN / ESPCN / Real-ESRGAN general-x4v3 before deciding | New conversion work with unverified provenance, outside the epic's bounded adapter pass. Recorded as a reopen path, not a decision input. |
| Tune tiles / retry on a quiet machine before deciding | Would narrow error bars on time, not change the sign: the 21× and 190× gaps and the quality rows are not contention artifacts. |
| Keep "ML upscaling is planned separately." in the UI | The copy promises a feature with no owner and no issue. It must go. |

## Evidence limits

- The measuring machine was not quiet: other sessions ran `vitest`, `tsc` and
  `workerd` during timed runs, and one project's Playwright run overlapped
  part of the Swin2SR 2× benchmark, contaminating the Swin2SR 2× alpha-2x
  timing cell. That cell was not re-run on a quiet machine.
- WebGPU and multi-threaded WASM were unavailable/unmeasured on this machine.
- GPU device allocations and native allocation ownership are not captured by
  RSS.
- The quality corpus measures inversion of the repository's own area-
  reduction pipeline, not real-world low-resolution upscaling.
- The one native low-resolution photo is visual-only, with no ground truth.
- Swin2SR's in-browser abort/dispose contract probes were not run (ESRGAN
  Slim's were).
- The small-CNN family (FSRCNN, ESPCN, Real-ESRGAN general-x4v3) was surveyed
  but never run.
- Offline cold start (installing a model while offline) was not tested.

## What would reopen it

Measured with the same harness and corpus on a quiet machine:

- A candidate with pinned, provenance-traced browser artifacts (weights and
  runtime licenses from their own LICENSE files) that beats Lanczos3 PSNR on
  a majority of the 14 rows including text and both alpha backgrounds, with
  no SSIM row worse than Lanczos3.
- Cached time ≤ 10× Lanczos3 per 512² output on the path it would actually
  ship on (measured WebGPU or multi-thread WASM counts only if the host
  header requirements are also solved), and 2048²→4096² completing within 5
  min.
- Load plus first-inference RSS delta ≤ 256 MiB (half the 512 MiB budget,
  leaving headroom for uncaptured GPU/native allocations), with no watchdog
  kill across ≥ 5 cold launches.
- Download ≤ 10 MB per scale, or a decided model-cache policy (Cache API
  namespace keyed by revision + SHA-256, quota, eviction, "clear downloaded
  models", offline failure behavior) if larger.
- A packaging path that passes `--frozen-lockfile`,
  `scripts/check-package-conformance.mjs`, `scripts/check-dist-artifact.mjs`
  and `smoke:host-install` without weakening the one-WASM assertion — or a
  reviewed architecture change that relaxes it deliberately.
- A product request for real-world low-resolution enlargement, evaluated
  with a perceptual criterion agreed in advance (the current corpus measures
  pipeline inversion).

## Prototype reference

The external prototype directory (not part of this repository) was laid out
as:

- `0-fixtures/` — the six-image corpus, stress input and realistic photo.
- `D-candidates/` — candidate/license desk review.
- `1-harness/` — the measurement harness, metrics and adapter contract.
- `2-adapters/` — one adapter per shortlisted candidate and scale.
- `3-benchmark/` — the benchmark runs, tables and crops.

The fixed adapter contract every candidate implemented:

```ts
export type RgbaImage = { width: number; height: number; data: Uint8ClampedArray };

export interface UpscaleAdapter {
  readonly backend: string; // "unloaded" before load; actual provider afterward
  load(): Promise<void>;
  upscale(rgba: RgbaImage, scale: 2 | 4,
          options: { signal: AbortSignal }): Promise<RgbaImage>;
  dispose(): void | Promise<void>;
}
```

`load()` is idempotent and performs loading only. `upscale()` validates
dimensions, byte length and output limit before allocation; does not mutate
its input; serializes calls; returns exact integer-scaled dimensions; and
rejects an aborted signal with `AbortError`. `dispose()` is idempotent,
releases runtime resources where supported, and prevents further inference.
The `backend` reports the actually selected provider (for example
`tfjs-webgl` or `ort-wasm`), never a capability guess.
