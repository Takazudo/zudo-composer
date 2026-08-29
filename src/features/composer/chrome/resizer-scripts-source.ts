// Source text for the inline blocking scripts rendered by resizer-scripts.tsx
// (issue #247). Split into a plain .ts module (no JSX) so it can be
// unit-tested directly — mirrors
// `src/features/styleguide/chrome/panel-scripts-source.ts`'s rationale
// exactly (an inline `<script>` can't `import` `resizer-contract.ts` at
// runtime, so THIS module interpolates its constants into the template
// strings below at SSR/build time instead of hand-typing the literals a
// second time).
//
// Two scripts:
//   RESTORE_SCRIPT — runs in <head>, before first paint. Reads both
//     persisted rail widths, applies the same joint clamp the interactive
//     resizer uses, and sets both CSS vars so a reload doesn't flash the
//     default layout.
//   RESIZER_SCRIPT — runs at body-end. Wires pointer-drag AND keyboard
//     (Arrow/Home/End) resizing for both rails, updating the CSS var live,
//     persisting the committed width, and dispatching
//     `WIDTH_CHANGE_EVENT` on `document` so the Preact controller
//     (`use-composer-controller.ts`) can mirror the committed width into
//     its own typed state without re-rendering on every pointermove.

import {
  ATTR_INSPECTOR_RESIZER,
  ATTR_TREE_RESIZER,
  CSS_VAR_INSPECTOR_W,
  CSS_VAR_TREE_W,
  DEFAULT_TREE_W,
  LS_INSPECTOR_WIDTH,
  LS_TREE_WIDTH,
  MAX_RAIL_W,
  MIN_CANVAS_W,
  MIN_RAIL_W,
  RESIZER_TRACK_W,
  WIDTH_CHANGE_EVENT,
} from "./resizer-contract";

export const RESTORE_SCRIPT = `(function(){
  try {
    var r = document.documentElement, ls = localStorage;
    var MIN=${MIN_RAIL_W}, MAX=${MAX_RAIL_W}, MIN_CANVAS=${MIN_CANVAS_W}, TRACK=${RESIZER_TRACK_W};
    function clampFor(otherW){ return Math.max(MIN, Math.min(MAX, window.innerWidth - otherW - MIN_CANVAS - TRACK)); }
    var tw = parseFloat(ls.getItem('${LS_TREE_WIDTH}'));
    var iw = parseFloat(ls.getItem('${LS_INSPECTOR_WIDTH}'));
    if (!isFinite(tw)) tw = ${DEFAULT_TREE_W};
    if (!isFinite(iw)) iw = MIN;
    tw = Math.max(MIN, Math.min(clampFor(iw), tw));
    iw = Math.max(MIN, Math.min(clampFor(tw), iw));
    r.style.setProperty('${CSS_VAR_TREE_W}', tw + 'px');
    r.style.setProperty('${CSS_VAR_INSPECTOR_W}', iw + 'px');
  } catch(e) {}
})();`;

export const RESIZER_SCRIPT = `(function(){
  var MIN=${MIN_RAIL_W}, MAX=${MAX_RAIL_W}, MIN_CANVAS=${MIN_CANVAS_W}, TRACK=${RESIZER_TRACK_W};
  var STEP = 16;
  var ACCENT_OUTLINE = '2px solid var(--color-focus, rgba(128,128,128,0.5))';
  var r = document.documentElement;

  function clampFor(otherW) { return Math.max(MIN, Math.min(MAX, window.innerWidth - otherW - MIN_CANVAS - TRACK)); }

  function readWidth(cssVar, fallback) {
    var raw = getComputedStyle(r).getPropertyValue(cssVar).trim();
    var n = parseFloat(raw);
    if (!n) return fallback;
    return raw.indexOf('rem') >= 0 ? n * parseFloat(getComputedStyle(r).fontSize) : n;
  }

  function persist(lsKey, val) {
    try { localStorage.setItem(lsKey, String(Math.round(val))); } catch (e) {}
  }

  function dispatchChange(rail, width) {
    document.dispatchEvent(new CustomEvent('${WIDTH_CHANGE_EVENT}', { detail: { rail: rail, width: width } }));
  }

  function attach(handle, opts) {
    // opts: { cssVar, lsKey, otherCssVar, edge: 'left'|'right', rail }
    var dragging = false, focused = false;
    function otherWidth() { return readWidth(opts.otherCssVar, MIN); }
    var cached = readWidth(opts.cssVar, MIN);

    function updateVisual() {
      handle.style.outline = (focused && !dragging) ? ACCENT_OUTLINE : '';
      handle.style.outlineOffset = (focused && !dragging) ? '-2px' : '';
    }

    function apply(px) {
      // Live path -- runs on every pointermove, so this stays DOM/CSS-only
      // (CSS var + persisted width + ARIA), matching the code-panel
      // resizer's per-move cost. dispatchChange is deliberately NOT called
      // here: it bridges into the Preact controller's state, and firing a
      // re-render on every pixel of a drag would visibly jank the drag
      // itself. Callers commit a dispatch explicitly (pointer release,
      // each discrete keydown) via commit() below.
      cached = Math.max(MIN, Math.min(clampFor(otherWidth()), px));
      r.style.setProperty(opts.cssVar, cached + 'px');
      persist(opts.lsKey, cached);
      handle.setAttribute('aria-valuemax', String(Math.round(clampFor(otherWidth()))));
      handle.setAttribute('aria-valuenow', String(Math.round(cached)));
    }

    function commit() {
      dispatchChange(opts.rail, cached);
    }

    handle.setAttribute('aria-valuemin', String(MIN));
    handle.setAttribute('aria-valuemax', String(Math.round(clampFor(otherWidth()))));
    handle.setAttribute('aria-valuenow', String(Math.round(cached)));

    handle.addEventListener('focus', function(){ focused = true; updateVisual(); });
    handle.addEventListener('blur', function(){ focused = false; updateVisual(); });

    handle.addEventListener('keydown', function(e) {
      // The rail whose edge is nearest the canvas grows when Arrow points
      // toward the canvas: 'left' edge (tree) grows on ArrowRight, 'right'
      // edge (inspector) grows on ArrowLeft — matching pointer-drag direction.
      var sign = opts.edge === 'left' ? 1 : -1;
      var w = cached;
      if (e.key === 'ArrowRight') w += STEP * sign;
      else if (e.key === 'ArrowLeft') w -= STEP * sign;
      else if (e.key === 'Home') w = MIN;
      else if (e.key === 'End') w = clampFor(otherWidth());
      else return;
      e.preventDefault();
      apply(w);
      commit();
    });

    handle.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      handle.setAttribute('data-sg-dragging', '');
      handle.setPointerCapture(e.pointerId);
      dragging = true;
      updateVisual();
      function onMove(ev) {
        var px = opts.edge === 'left' ? ev.clientX : (window.innerWidth - ev.clientX);
        apply(px);
      }
      function onUp() {
        handle.removeAttribute('data-sg-dragging');
        dragging = false;
        updateVisual();
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        handle.removeEventListener('lostpointercapture', onUp);
        commit();
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
      handle.addEventListener('lostpointercapture', onUp);
    });
  }

  function init() {
    var tree = document.querySelector('[${ATTR_TREE_RESIZER}]');
    var inspector = document.querySelector('[${ATTR_INSPECTOR_RESIZER}]');
    if (tree && !tree.__sgWired) {
      tree.__sgWired = true;
      attach(tree, { cssVar: '${CSS_VAR_TREE_W}', lsKey: '${LS_TREE_WIDTH}', otherCssVar: '${CSS_VAR_INSPECTOR_W}', edge: 'left', rail: 'tree' });
    }
    if (inspector && !inspector.__sgWired) {
      inspector.__sgWired = true;
      attach(inspector, { cssVar: '${CSS_VAR_INSPECTOR_W}', lsKey: '${LS_INSPECTOR_WIDTH}', otherCssVar: '${CSS_VAR_TREE_W}', edge: 'right', rail: 'inspector' });
    }
    return !!(tree && tree.__sgWired && inspector && inspector.__sgWired);
  }

  // The workspace mounts as a "when: load" island, so this body-end script
  // usually runs BEFORE the resizer elements exist. Wire whatever is present
  // now, then observe until the island hydrates and both rails are wired
  // (per-element __sgWired keeps re-runs idempotent). A stale one-shot global
  // guard here used to wire nothing yet block every retry — that was the bug.
  if (window.__sgComposerResizerObserver) {
    window.__sgComposerResizerObserver.disconnect();
    window.__sgComposerResizerObserver = null;
  }
  if (!init() && typeof MutationObserver !== 'undefined') {
    var obs = new MutationObserver(function(){
      if (init()) { obs.disconnect(); window.__sgComposerResizerObserver = null; }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    window.__sgComposerResizerObserver = obs;
    // Safety valve: the island mounts on \`load\`, so init() normally succeeds
    // within a second. If the rails never appear (e.g. the user navigated away
    // before hydration), stop observing rather than watch the whole document
    // forever.
    setTimeout(function(){
      if (window.__sgComposerResizerObserver === obs) {
        obs.disconnect();
        window.__sgComposerResizerObserver = null;
      }
    }, 15000);
  }
})();`;
