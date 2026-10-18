# AI Assistant verification

Evidence for the AI Assistant comes in four separate classes. A result from one
class never stands in for another.

| Class | Command | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Deterministic / fake provider | `pnpm vitest run server/assistant server/edit src/features/assistant` | Runner, store, draft service, adapter contract (scripted SSE) | Real model behavior |
| Fake browser | `pnpm test:browser:assistant` (port 4177, CI) | Real dev server, renderers, adapter and SDK with scripted replies | Real model behavior |
| Live inference | `pnpm test:browser:assistant:live` (port 4177, opt-in) | Real `claude-opus-5-5` replies through the product adapter on the real UI | Physical devices, installed package |
| Installed package | `pnpm edit:installed`, `pnpm hosted:installed <C>` | The packed tool in a consumer host | Live model, physical devices |
| Physical device | Checklist below | Real IME, touch and virtual keyboards | Anything automated |

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

### Status

No live run has been recorded yet: no credential provisioned for this purpose
was available in the verification environments. When a run is recorded, its
`result.json` goes in `verification/assistant/live-<sha8>/`.

## Physical device checklist

Do this checklist by hand on a Mac (Japanese IME) and on a foldable Android phone
(touch, virtual keyboard, folded and unfolded). Use a disposable host from
`node scripts/assistant/prepare-host.mjs landing <new-dir>`, plus either the
live key or a local fake API. Record the device, OS, browser, input method,
commit, and pass or fail with a photo or screen recording for each item.

1. Type Japanese in the message box with the IME. Pressing Enter to confirm a
   conversion must not send; a second Enter sends the confirmed text.
2. On the narrow layout, switch between Conversation and Page with touch. The
   virtual keyboard must not cover the message box or the Send/Stop buttons.
3. In Page, tap **Select block** and then a block. The selection chip appears
   and no link navigates.
4. In Draft, the yellow words, the outlined block and its label stay aligned
   while you scroll, pinch-zoom, rotate and fold or unfold the device.
5. Open Memory, edit it with the IME, Save, then Close. Unsaved text asks before
   it is discarded.
6. Apply and Undo with touch. Each takes one tap and shows the receipt heading.
