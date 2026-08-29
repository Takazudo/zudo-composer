import {
  ATTR_INSPECTOR_RESIZER, ATTR_TREE_RESIZER, CSS_VAR_INSPECTOR_W, CSS_VAR_TREE_W,
  DEFAULT_TREE_W, LS_INSPECTOR_WIDTH, LS_TREE_WIDTH, MIN_RAIL_W, WIDTH_CHANGE_EVENT,
  clampRailWidth, getPersistedWidth, setPersistedWidth,
} from "./resizer-contract";

export function restoreComposerWidths(): void {
  const root = document.documentElement;
  let tree = getPersistedWidth(LS_TREE_WIDTH, DEFAULT_TREE_W);
  let inspector = getPersistedWidth(LS_INSPECTOR_WIDTH, MIN_RAIL_W);
  tree = clampRailWidth(tree, inspector, window.innerWidth);
  inspector = clampRailWidth(inspector, tree, window.innerWidth);
  root.style.setProperty(CSS_VAR_TREE_W, `${tree}px`);
  root.style.setProperty(CSS_VAR_INSPECTOR_W, `${inspector}px`);
}

export function installComposerResizers(): () => void {
  const wired = new WeakSet<Element>();
  const cleanups = new Set<() => void>();
  const wire = (handle: HTMLElement, rail: "tree" | "inspector") => {
    if (wired.has(handle)) return;
    wired.add(handle);
    const cssVar = rail === "tree" ? CSS_VAR_TREE_W : CSS_VAR_INSPECTOR_W;
    const otherVar = rail === "tree" ? CSS_VAR_INSPECTOR_W : CSS_VAR_TREE_W;
    const storageKey = rail === "tree" ? LS_TREE_WIDTH : LS_INSPECTOR_WIDTH;
    const width = () => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar)) || MIN_RAIL_W;
    const otherWidth = () => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(otherVar)) || MIN_RAIL_W;
    const apply = (candidate: number) => {
      const value = clampRailWidth(candidate, otherWidth(), window.innerWidth);
      document.documentElement.style.setProperty(cssVar, `${value}px`);
      handle.setAttribute("aria-valuenow", String(Math.round(value)));
      setPersistedWidth(storageKey, value);
      document.dispatchEvent(new CustomEvent(WIDTH_CHANGE_EVENT, { detail: { rail, width: value } }));
    };
    const keydown = (event: KeyboardEvent) => {
      const direction = rail === "tree" ? 1 : -1;
      if (event.key === "Home") apply(MIN_RAIL_W);
      else if (event.key === "ArrowRight") apply(width() + 16 * direction);
      else if (event.key === "ArrowLeft") apply(width() - 16 * direction);
      else return;
      event.preventDefault();
    };
    const pointerdown = (event: PointerEvent) => {
      event.preventDefault();
      const move = (next: PointerEvent) => apply(rail === "tree" ? next.clientX : window.innerWidth - next.clientX);
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true });
    };
    handle.addEventListener("keydown", keydown);
    handle.addEventListener("pointerdown", pointerdown);
    cleanups.add(() => { handle.removeEventListener("keydown", keydown); handle.removeEventListener("pointerdown", pointerdown); });
  };
  const scan = () => {
    const tree = document.querySelector<HTMLElement>(`[${ATTR_TREE_RESIZER}]`);
    const inspector = document.querySelector<HTMLElement>(`[${ATTR_INSPECTOR_RESIZER}]`);
    if (tree) wire(tree, "tree");
    if (inspector) wire(inspector, "inspector");
  };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => { observer.disconnect(); for (const cleanup of cleanups) cleanup(); };
}
