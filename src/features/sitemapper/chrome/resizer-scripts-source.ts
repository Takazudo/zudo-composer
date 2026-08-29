// Source text for the inline blocking scripts rendered by
// resizer-scripts.tsx (issue #409).
//
// The script tags cannot import TypeScript at runtime. This plain module is
// therefore the build-time bridge: it interpolates the single-source
// constants from resizer-contract.ts so a renamed Sitemapper key, event,
// attribute, or custom property cannot drift from the JSX shell.
//
// RESTORE_SCRIPT runs in <head> before first paint. RESIZER_SCRIPT runs at
// body-end, wires whichever rails already exist, and observes for the
// when="load" island to hydrate the rest. Pointer moves stay on the cheap
// CSS/DOM path; the shared width-change event is dispatched only on a commit
// (pointer release or discrete keyboard step).

import {
  ATTR_INSPECTOR_RESIZER,
  ATTR_TREE_RESIZER,
  CSS_VAR_INSPECTOR_W,
  CSS_VAR_TREE_W,
  DEFAULT_INSPECTOR_W,
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
    var root = document.documentElement, ls = localStorage;
    var MIN=${MIN_RAIL_W}, MAX=${MAX_RAIL_W}, MIN_CANVAS=${MIN_CANVAS_W}, TRACK=${RESIZER_TRACK_W};
    function clampFor(otherWidth) {
      return Math.max(MIN, Math.min(MAX, window.innerWidth - otherWidth - MIN_CANVAS - TRACK));
    }
    var treeWidth = parseFloat(ls.getItem('${LS_TREE_WIDTH}'));
    var inspectorWidth = parseFloat(ls.getItem('${LS_INSPECTOR_WIDTH}'));
    if (!isFinite(treeWidth)) treeWidth = ${DEFAULT_TREE_W};
    if (!isFinite(inspectorWidth)) inspectorWidth = ${DEFAULT_INSPECTOR_W};
    treeWidth = Math.max(MIN, Math.min(clampFor(inspectorWidth), treeWidth));
    inspectorWidth = Math.max(MIN, Math.min(clampFor(treeWidth), inspectorWidth));
    root.style.setProperty('${CSS_VAR_TREE_W}', treeWidth + 'px');
    root.style.setProperty('${CSS_VAR_INSPECTOR_W}', inspectorWidth + 'px');
  } catch(e) {}
})();`;

export const RESIZER_SCRIPT = `(function(){
  var MIN=${MIN_RAIL_W}, MAX=${MAX_RAIL_W}, MIN_CANVAS=${MIN_CANVAS_W}, TRACK=${RESIZER_TRACK_W};
  var STEP = 16;
  var ACCENT_OUTLINE = '2px solid var(--color-focus)';
  var root = document.documentElement;

  function clampFor(otherWidth) {
    return Math.max(MIN, Math.min(MAX, window.innerWidth - otherWidth - MIN_CANVAS - TRACK));
  }

  function readWidth(cssVar, fallback) {
    var raw = getComputedStyle(root).getPropertyValue(cssVar).trim();
    var value = parseFloat(raw);
    if (!isFinite(value) || value <= 0) return fallback;
    return raw.indexOf('rem') >= 0 ? value * parseFloat(getComputedStyle(root).fontSize) : value;
  }

  function persist(lsKey, width) {
    try { localStorage.setItem(lsKey, String(Math.round(width))); } catch (e) {}
  }

  function dispatchChange(rail, width) {
    document.dispatchEvent(new CustomEvent('${WIDTH_CHANGE_EVENT}', {
      detail: { rail: rail, width: width }
    }));
  }

  function attach(handle, options) {
    // options: { cssVar, lsKey, otherCssVar, edge: 'left'|'right', rail }
    var dragging = false, focused = false;
    function otherWidth() { return readWidth(options.otherCssVar, MIN); }
    var cached = readWidth(options.cssVar, MIN);

    function updateVisual() {
      handle.style.outline = (focused && !dragging) ? ACCENT_OUTLINE : '';
      handle.style.outlineOffset = (focused && !dragging) ? '-2px' : '';
    }

    function apply(px) {
      // This is the live pointer path. Do not dispatch into the Preact tree
      // for every pixel of a drag; callers commit after the gesture/key step.
      cached = Math.max(MIN, Math.min(clampFor(otherWidth()), px));
      root.style.setProperty(options.cssVar, cached + 'px');
      persist(options.lsKey, cached);
      handle.setAttribute('aria-valuemax', String(Math.round(clampFor(otherWidth()))));
      handle.setAttribute('aria-valuenow', String(Math.round(cached)));
    }

    function commit() {
      dispatchChange(options.rail, cached);
    }

    handle.setAttribute('aria-valuemin', String(MIN));
    handle.setAttribute('aria-valuemax', String(Math.round(clampFor(otherWidth()))));
    handle.setAttribute('aria-valuenow', String(Math.round(cached)));

    handle.addEventListener('focus', function(){ focused = true; updateVisual(); });
    handle.addEventListener('blur', function(){ focused = false; updateVisual(); });

    handle.addEventListener('keydown', function(event) {
      // The edge nearest the canvas grows toward the canvas: tree grows on
      // ArrowRight, inspector grows on ArrowLeft. Home/End choose the joint
      // minimum/maximum for either rail.
      var sign = options.edge === 'left' ? 1 : -1;
      var width = cached;
      if (event.key === 'ArrowRight') width += STEP * sign;
      else if (event.key === 'ArrowLeft') width -= STEP * sign;
      else if (event.key === 'Home') width = MIN;
      else if (event.key === 'End') width = clampFor(otherWidth());
      else return;
      event.preventDefault();
      apply(width);
      commit();
    });

    handle.addEventListener('pointerdown', function(event) {
      event.preventDefault();
      handle.setAttribute('data-sg-dragging', '');
      handle.setPointerCapture(event.pointerId);
      dragging = true;
      updateVisual();

      function onMove(moveEvent) {
        var width = options.edge === 'left'
          ? moveEvent.clientX
          : (window.innerWidth - moveEvent.clientX);
        apply(width);
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
      attach(tree, {
        cssVar: '${CSS_VAR_TREE_W}',
        lsKey: '${LS_TREE_WIDTH}',
        otherCssVar: '${CSS_VAR_INSPECTOR_W}',
        edge: 'left',
        rail: 'tree'
      });
    }
    if (inspector && !inspector.__sgWired) {
      inspector.__sgWired = true;
      attach(inspector, {
        cssVar: '${CSS_VAR_INSPECTOR_W}',
        lsKey: '${LS_INSPECTOR_WIDTH}',
        otherCssVar: '${CSS_VAR_TREE_W}',
        edge: 'right',
        rail: 'inspector'
      });
    }
    return !!(
      tree && tree.__sgWired && inspector && inspector.__sgWired
    );
  }

  // Body-end executes before a load island necessarily hydrates. Wire any
  // existing rail now, then observe until both are present. The marker lives
  // on each element, so retries are idempotent and a late island is safe.
  if (window.__sgSitemapperResizerObserver) {
    window.__sgSitemapperResizerObserver.disconnect();
    window.__sgSitemapperResizerObserver = null;
  }
  if (!init() && typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function(){
      if (init()) {
        observer.disconnect();
        window.__sgSitemapperResizerObserver = null;
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__sgSitemapperResizerObserver = observer;
    setTimeout(function(){
      if (window.__sgSitemapperResizerObserver === observer) {
        observer.disconnect();
        window.__sgSitemapperResizerObserver = null;
      }
    }, 15000);
  }
})();`;
