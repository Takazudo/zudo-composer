# AI Assistant verification

Evidence for the AI Assistant comes in separate classes. A result from one
class never stands in for another.

| Class | Command | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Deterministic / fake provider | `pnpm vitest run server/assistant server/edit src/features/assistant` | Runner, store, draft service, adapter contract (scripted SSE) | Real model behavior |
| Fake browser | `pnpm test:browser:assistant` (port 4177, CI) | Real dev server, renderers, adapter and SDK with scripted replies, plus the [device checks](#device-checks) | Real model behavior, OS input methods and hardware |
| Live inference | `pnpm test:browser:assistant:live` (port 4177, opt-in) | Real `claude-opus-5-5` replies through the product adapter on the real UI | Device behavior, installed package |
| Installed package | `pnpm edit:installed`, `pnpm hosted:installed <C>` | The packed tool in a consumer host | Live model, device behavior |

## Live lane

The live lane drives the same UI as the fake browser lane on new disposable
hosts seeded from Orrery, Margin Notes and Nightjar Supply. Model replies are
never scripted. The authoring server's own adapter sends to a loopback meter
(`scripts/assistant/live-meter.mjs`), which forwards each request unchanged to
the Messages API and streams the response back unchanged. The meter only
records the contract (requested and served model, thinking, effort, fallbacks,
beta header, tools, stop reason, block types, fallback hops, usage) and refuses
any request whose worst-case cost would pass the approved cap.

### Before spending

1. `node scripts/verify-assistant-live.mjs --plan` prints the provider, model,
   upstream, every message the lane sends, the synthetic attachment size and
   the limits. Review it and agree on a spend cap.
2. Use a key provisioned for this purpose in `ZUDO_ASSISTANT_LIVE_API_KEY`. The
   lane never reads `ANTHROPIC_API_KEY`, and a Claude Code login must not be
   used. The key reaches only the authoring server process and the meter's
   in-memory forwarding; it is never logged, written or sent to the browser.

### Running

```sh
ZUDO_ASSISTANT_LIVE_API_KEY=… ZUDO_ASSISTANT_LIVE_MAX_USD=15 \
  corepack pnpm test:browser:assistant:live
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `ZUDO_ASSISTANT_LIVE_MAX_USD` | none (required) | Approved cap, at most 50. The meter fails closed. |
| `ZUDO_ASSISTANT_LIVE_MAX_REQUESTS` | 90 | Hard cap on forwarded model calls. |
| `ZUDO_ASSISTANT_LIVE_UPSTREAM` | `https://api.anthropic.com` | A loopback URL marks the run as harness smoke, never live evidence. |
| `ZUDO_ASSISTANT_LIVE_EVIDENCE_DIR` | `test-results/assistant-live` | Where `result.json` and screenshots go. |
| `ZUDO_ASSISTANT_LIVE_ALLOW_CI` | unset | The lane refuses to run under `CI` without it. |

Without the key or the cap, the lane writes `status: "blocked"` with the reasons
and exits 3. Behind an HTTP proxy, run it on Node 24 with
`NODE_USE_ENV_PROXY=1` so the meter's `fetch` uses the proxy.

### Reading the result

`result.json` records the commit SHA and dirty flag, the plan, and every check
with its expectation, observation and verdict: `pass`, `fail`, or
`deterministic-only` for behavior that is proven by the deterministic suites
instead of costly live failure injection (lost Apply response, Undo after a later
edit, late-run fencing, Memory CAS). It also holds each turn's reply, Memory
revision used, tools called and metered requests, a contract summary and the
spend. Checks judge meaning, target, structure, invariants and saved results,
not exact wording. Every turn runs once: there are no retries and no selection
of good runs, and a failed check is kept. Host paths are replaced with
`<host-N>`. Before you commit a result, read it to confirm that it carries no
key and no private text.

### Journeys

- **A**: Read only Memory proposal, human approval, use in another conversation (actual input and revision).
- **B**: Selected-field update (English), first feature body (Japanese), registered component insert; canonical bytes unchanged.
- **C**: Draft and Current annotations, second page and two-page review, Withdraw, zero diff.
- **D**: Two-page atomic Apply with receipt, reload, Undo.
- **E**: Memory correction in the same and a new conversation, Off, Auto remember, Clear.
- **F**: Ambiguous, unsupported and Mapping-owned requests change nothing; restart keeps state; same workspace id on another host shares nothing.
- **G** (Margin Notes): exact long attachment, `read_field` before a narrow long-field fix, Discard, narrow edit and Apply.
- **H** (Nightjar Supply): selected-heading edit and Apply.
- **I** (`fixtures/edit-host`): exact Japanese text, table and managed image inserted by reference at three requested positions, Discard, then a position inside a Markdown block that must not become a new block.

### Status

No live run has been recorded yet: no credential provisioned for this purpose
was available in the verification environments. When a run is recorded, its
`result.json` goes in `verification/assistant/live-<sha8>/`.

## Device checks

The former hand-run device checklist is now part of the fake browser lane
(`deviceJourneys` in `scripts/verify-assistant-browser.mjs`), run on a
disposable Orrery host in headless Chromium. They are browser-level emulation:
Chromium's own composition and touch input, not an OS input method or real
hardware.

| Former check | Automated check |
| --- | --- |
| Japanese IME: a converting Enter does not send; the next Enter sends | CDP `Input.imeSetComposition` + `Input.insertText` in the message box. Enter during an active composition (Chromium order, `isComposing`) and Enter with keyCode 229 after the commit (WebKit order) each reach the page and send nothing, and no model request is made. The next Enter sends exactly the confirmed text `日本語です`. |
| Memory with the IME; unsaved text asks first | The same composition in the Memory editor commits exactly. Close on unsaved text asks before discarding, and the saved text reaches the next model call. |
| Narrow Conversation/Page by touch; virtual keyboard leaves message box and Send/Stop visible | `hasTouch` + `isMobile` contexts at Galaxy Fold sizes 344×882 (folded) and 673×841 (unfolded). Tabs switch by tap. The authoring document declares `interactive-widget=resizes-content`. At 55% height, the message box, Send and the running Stop stay inside the viewport. |
| Select block by touch; no link navigates | Tapping a link inside a block while selecting selects that block. The preview and editor URLs stay unchanged. |
| Draft highlights stay aligned (scroll, zoom, rotate, fold) | Each outline sits 4px outside its block and each label sits on the outline's outer edge, within ±2px. Every yellow word lies inside an outlined block, and labels never intercept pointer hits. This is checked on desktop, after keyboard navigation, after scroll and resize, at both Fold sizes and through 390×844 → 844×390 → 390×844 rotation. |
| Apply and Undo with one tap and a receipt | One tap each at both Fold sizes. The Page view and its receipt return after the editor reloads under the new write epoch. Undo restores the saved JSON/JSX. |
| Short narrow layouts keep the Bot heading, Rename and the preview usable | With a virtual keyboard at both Fold sizes and at 844×390, the Bot `h1` stays in the accessibility tree and Rename is on screen and opens its form. At 844×390, the message box and Send are on screen. In every narrow Page view, the preview is at least half the viewport tall and at least half visible below the sticky tabs, and the review list never covers it. |
| A stored view value is trusted only when valid | Junk stored tab values (`"junk"`, an object, a number) open the Conversation view alone, with the Page pane hidden. |
| Keyboard focus | Tab and Enter alone reach Draft, a change in the review list, Apply and Undo. Each target matches `:focus-visible` with a visible outline of at least 2px. |
| Annotations never leave the editor | After Apply, saved JSON/JSX and the visitor `/website-preview` document contain no annotation markup or highlights. |

The lane saves `device-draft-desktop.png`, `device-draft-fold-folded.png`,
`device-draft-fold-unfolded.png`, `device-draft-landscape.png` and
`device-conversation-landscape.png` to
`test-results/assistant-browser/` for visual review.

### Optional hands-on checks

These cannot be automated in a headless browser. None of them gates a change:

- An OS input method's own candidate window: macOS Japanese IME, Android Gboard.
- How a real on-screen keyboard overlays or resizes the page in a given browser, including iOS Safari, which ignores `interactive-widget`.
- Pinch-zoom of the visual viewport and the physical fold or unfold hinge transition.
- Engines other than Chromium.
