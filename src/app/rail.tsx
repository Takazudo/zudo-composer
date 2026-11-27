import { hostDocumentPreviewConfigured, savedHostPreviewHref } from "../features/delivery/host-preview-policy";
import { computed, For, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import {
  ComposerIcon,
  ContentIcon,
  ExternalLinkIcon,
  FolderIcon,
  HomeIcon,
  MappingIcon,
  PageIcon,
  SitemapperIcon,
  type IconComponent,
} from "../components/icons";
import { Button, DisclosureButton } from "../components/ui";
import { Dialog, Menu, MenuItem, createMenu } from "../components/overlay";
import { formatIntent } from "./route-intents";
import { pinAvailable, type NavigationModel, type NavigationPin } from "./navigation-preferences";
import type { WorkspaceCounts } from "./workspace-summary";
import { createDomId } from "../components/use-dom-id";
import { read, toSignal, type MaybeSignal } from "../components/reactive";

// The workspace rail (issue #161): the dark graphite sidebar that replaced the
// top navigation header, and the bottom tab strip the same markup becomes below
// 64rem. Grouping follows the prototype — one Dashboard entry, then the records
// an author writes, then the structures they are placed into.

export type RailItemId = "home" | "content" | "assets" | "composer" | "mapping" | "sitemapper" | "review" | "site";

export interface RailItem {
  readonly id: RailItemId;
  readonly label: string;
  readonly href: string;
  readonly icon: IconComponent;
  /**
   * A destination rendered outside the CMS chrome, marked with an external
   * glyph and never given `aria-current`.
   */
  readonly external?: true;
  /** Opens its own document in a new tab; the rail leaves the click to the browser. */
  readonly newTab?: true;
  /** Accessible name; required for `external`, where "Site" alone is ambiguous. */
  readonly accessibleName?: string;
}

export interface RailGroup {
  readonly id: string;
  /** Rendered as an uppercase divider; the leading group has none. */
  readonly label?: string;
  readonly items: readonly RailItem[];
}

export const RAIL_GROUPS: readonly RailGroup[] = [
  {
    id: "overview",
    items: [{ id: "home", label: "Overview", href: "/", icon: HomeIcon }],
  },
  {
    id: "author",
    label: "Author",
    items: [
      { id: "content", label: "Content", href: "/content", icon: ContentIcon },
      { id: "assets", label: "Assets", href: "/assets", icon: FolderIcon },
    ],
  },
  {
    id: "structure",
    label: "Structure",
    items: [
      { id: "composer", label: "Compositions", href: "/composer", icon: ComposerIcon },
      { id: "mapping", label: "Mappings", href: "/mapping", icon: MappingIcon },
      { id: "sitemapper", label: "Sitemaps", href: "/sitemapper", icon: SitemapperIcon },
      { id: "review", label: "Review & release", href: "/review", icon: PageIcon },
      {
        id: "site",
        label: hostDocumentPreviewConfigured ? "Saved host page preview" : "Website preview",
        href: hostDocumentPreviewConfigured ? savedHostPreviewHref : "/website-preview",
        icon: PageIcon,
        newTab: true,
        accessibleName: hostDocumentPreviewConfigured ? "Saved host page preview" : "Website preview — choose preview source",
      },
    ],
  },
] as const;

export const RAIL_ITEMS: readonly RailItem[] = RAIL_GROUPS.flatMap((group) => group.items);

export type RailCounts = Partial<Record<RailItemId, number>>;

/**
 * Fold the workspace read model into the rail's count slots. A source that
 * could not be read contributes nothing, so an unavailable provider leaves the
 * slot empty rather than showing a zero it cannot vouch for.
 */
export function railCounts(counts: WorkspaceCounts | null): RailCounts {
  if (!counts) return {};
  const railCount: RailCounts = {};
  if (counts.content.status === "ok") railCount.content = counts.content.value.models;
  if (counts.assets.status === "ok") railCount.assets = counts.assets.value.assets;
  if (counts.compositions.status === "ok") railCount.composer = counts.compositions.value.compositions;
  if (counts.mappings.status === "ok") railCount.mapping = counts.mappings.value.mappings;
  if (counts.sitemaps.status === "ok") railCount.sitemapper = counts.sitemaps.value.sitemaps;
  return railCount;
}

export const RAIL_STORAGE_KEY = "zudo-composer-rail";

export type RailState = "expanded" | "collapsed";

function isRailState(value: unknown): value is RailState {
  return value === "expanded" || value === "collapsed";
}

/** `localStorage`, or `null` where a document denies it (privacy modes, sandboxes). */
function defaultRailStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRailState(storage: Storage | null = defaultRailStorage()): RailState {
  if (!storage) return "expanded";
  try {
    const value = storage.getItem(RAIL_STORAGE_KEY);
    if (isRailState(value)) return value;
    if (value !== null) storage.removeItem(RAIL_STORAGE_KEY);
  } catch {
    // A throwing Storage API still resolves to the expanded default in memory.
  }
  return "expanded";
}

export function persistRailState(state: RailState, storage: Storage | null = defaultRailStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(RAIL_STORAGE_KEY, state);
  } catch {
    // The session still honours the choice when persistence is unavailable.
  }
}

/** The rail item a pathname is currently inside, or `null` for an unknown route. */
export function currentRailItem(path: string): RailItem | null {
  const normalized = path === "" ? "/" : path;
  // A destination that opens in its own tab is never the authoring document's
  // own route, so it can never be the current item.
  return RAIL_ITEMS.find((item) => !item.external && !item.newTab && item.href === normalized.split("?")[0]) ?? null;
}

export interface RailProps {
  hostedDemo?: boolean;
  path: MaybeSignal<string>;
  collapsed: MaybeSignal<boolean>;
  onToggleCollapsed: () => void;
  counts?: MaybeSignal<RailCounts>;
  models?: MaybeSignal<readonly NavigationModel[]>;
  modelError?: MaybeSignal<string | null>;
  pins?: MaybeSignal<readonly NavigationPin[]>;
  onPinsChange?: (pins: NavigationPin[]) => void;
  onBrowse?: () => void;
  onNavigate?: (href: string, source?: Element | null) => void;
  hideToggle?: boolean;
  /**
   * Called on `pointerdown` and Enter activation of a `newTab` item, before
   * the browser opens it. A head start for the caller's own async work (a
   * session flush) — never a gate on the navigation itself.
   */
  onBeforeNewTab?: (item: RailItem) => void;
}

type AnchorClick = MouseEvent & { currentTarget: HTMLAnchorElement };

const NO_COUNTS: RailCounts = Object.freeze({});
const NO_MODELS: readonly NavigationModel[] = Object.freeze([]);
const NO_PINS: readonly NavigationPin[] = Object.freeze([]);

export function Rail({ path, collapsed, onToggleCollapsed, counts = NO_COUNTS, models = NO_MODELS, modelError = null, pins = NO_PINS, onPinsChange, onBrowse, onNavigate, hideToggle, hostedDemo = false, onBeforeNewTab }: RailProps) {
  const pathValue = toSignal(path);
  const isCollapsed = computed(() => read(collapsed));
  const expanded = computed(() => !isCollapsed.value);
  const countValues = toSignal(counts);
  const modelList = toSignal(models);
  const modelErrorText = toSignal(modelError);
  const pinList = toSignal(pins);
  const current = computed(() => currentRailItem(pathValue.value));
  const navId = `cms-rail-nav-${createDomId()}`;
  const contentOpen = signal(true);
  const rename = signal<NavigationPin | null>(null);
  const label = signal("");
  const navigate = (event: AnchorClick, href: string) => {
    if (!onNavigate || event.currentTarget.target || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(href, event.currentTarget);
  };
  const addPin = (pin: NavigationPin) => {
    const currentPins = pinList.value;
    if (!currentPins.some((value) => formatIntent(value.target) === formatIntent(pin.target))) onPinsChange?.([...currentPins, pin]);
  };
  const showContentTree = computed(() => expanded.value && contentOpen.value);
  const showPins = computed(() => expanded.value && pinList.value.length > 0);
  return (
    <div class="cms-rail" data-compact={computed(() => String(isCollapsed.value))}>
      <a class="cms-rail__brand" href="/" on:click={(event) => navigate(event, "/")}>
        <span class="cms-rail__logo" aria-hidden="true">Z</span>
        <span class="cms-rail__brand-name">zudo-composer</span>
      </a>
      {!hideToggle && <div class="cms-rail__toolbar"><DisclosureButton expanded={expanded} aria-label={computed(() => (isCollapsed.value ? "Expand navigation" : "Collapse navigation"))} aria-controls={navId} on:click={onToggleCollapsed} class="cms-rail__collapse" />{onBrowse ? <Show when={isCollapsed}>{() => <Button size="xs" variant="ghost" on:click={onBrowse} aria-label="Browse navigation">Browse</Button>}</Show> : null}</div>}
      <nav id={navId} class="cms-rail__nav" aria-label="Main navigation">
        {RAIL_GROUPS.map((group) => (
          <div key={group.id} class="cms-rail__group">
            {group.label ? (
              // The visible divider is decorative: the list below carries the
              // same name through `aria-label`, which survives the collapse
              // that hides this text.
              <div class="cms-rail__section" aria-hidden="true">{group.label}</div>
            ) : null}
            <ul class="cms-rail__items" aria-label={group.label}>
              {group.items.map((item) => {
                const ItemIcon = item.icon;
                const count = computed(() => countValues.value[item.id]);
                const hasCount = computed(() => count.value !== undefined);
                return (
                  <li key={item.id}>
                    <div class="cms-rail__row">
                    {item.id === "content" ? <Show when={expanded}>{() => <DisclosureButton expanded={contentOpen} aria-label={computed(() => (contentOpen.value ? "Collapse Content models" : "Expand Content models"))} on:click={() => { contentOpen.value = !contentOpen.value; }} size="xs" variant="ghost" />}</Show> : null}
                    <a
                      class="cms-rail__item"
                      href={item.href}
                      on:click={(event) => navigate(event, item.href)}
                      {...(item.newTab ? {
                        "on:pointerdown": () => onBeforeNewTab?.(item),
                        "on:keydown": (event: KeyboardEvent) => { if (event.key === "Enter") onBeforeNewTab?.(item); },
                      } : {})}
                      target={item.newTab ? "_blank" : undefined}
                      rel={item.newTab ? "noopener" : undefined}
                      data-route={item.id}
                      aria-current={computed(() => (current.value?.id === item.id ? "page" : undefined))}
                      aria-label={item.accessibleName ?? item.label}
                      title={computed(() => (isCollapsed.value ? item.label : null))}
                    >
                      <ItemIcon size="sm" class="cms-rail__icon" />
                      <span class="cms-rail__label">{item.label}</span>
                      {item.external ? (
                        <ExternalLinkIcon size="xs" class="cms-rail__external" />
                      ) : (
                        // Decorative: the count repeats what the route itself
                        // shows, and reading it into the link name would make
                        // every item announce as "Content 2".
                        <Show when={hasCount}>{() => <span class="cms-rail__count" aria-hidden="true">{computed(() => String(count.value ?? ""))}</span>}</Show>
                      )}
                    </a>
                    </div>
                    {item.id === "content" ? <Show when={showContentTree}>{() => <ul class="cms-rail__tree" aria-label="Content models">
                      <Show when={computed(() => Boolean(modelErrorText.value))}>{() => <li role="status">{modelErrorText}</li>}</Show>
                      <For each={modelList} by={(model) => JSON.stringify(model)}>
                        {(entry) => {
                          const model = entry.value;
                          const target = { route: "content" as const, providerId: model.providerId, modelId: model.modelId };
                          const href = formatIntent(target);
                          return <li><div class="cms-rail__row"><a href={href} class="cms-rail__model" on:click={(event) => navigate(event, href)} title={`${model.label} · ${model.providerId} · ${model.kind === "single" ? "Singleton" : "Collection"}`} aria-current={computed(() => (pathValue.value === href ? "page" : undefined))}>{model.label}</a><RailActions label={`${model.label} actions`}><MenuItem onSelect={() => addPin({ label: model.label, target })}>Pin model</MenuItem>{model.views.map((view) => <MenuItem key={view.id} onSelect={() => addPin({ label: view.label, target: { ...target, viewId: view.id } })}>Pin {view.label}</MenuItem>)}</RailActions></div></li>;
                        }}
                      </For>
                    </ul>}</Show> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <Show when={showPins}>{() => <div class="cms-rail__group"><div class="cms-rail__section">Pinned views</div><ul class="cms-rail__items" aria-label="Pinned views">
          <For each={pinList} by={(pin) => `${formatIntent(pin.target)}\u0000${pin.label}`}>
            {(entry, index) => {
              const pin = entry.value;
              const href = formatIntent(pin.target);
              const available = computed(() => pinAvailable(pin, modelList.value));
              const move = (offset: number) => { const next = [...pinList.value]; const at = index.value; [next[at], next[at + offset]] = [next[at + offset]!, next[at]!]; onPinsChange?.(next); };
              return <li class="cms-rail__row"><Show when={available} fallback={() => <span class="cms-rail__model" title="This model or view is unavailable">{pin.label} · unavailable</span>}>{() => <a class="cms-rail__model" href={href} on:click={(event) => navigate(event, href)}>{pin.label}</a>}</Show><RailActions label={`${pin.label} pin actions`}><MenuItem onSelect={() => { rename.value = pin; label.value = pin.label; }}>Rename pin</MenuItem><MenuItem disabled={computed(() => index.value === 0)} onSelect={() => move(-1)}>Move up</MenuItem><MenuItem disabled={computed(() => index.value === pinList.value.length - 1)} onSelect={() => move(1)}>Move down</MenuItem><MenuItem onSelect={() => onPinsChange?.(pinList.value.filter((value) => value !== pin))}>Remove pin</MenuItem></RailActions></li>;
            }}
          </For>
        </ul></div>}</Show>
      </nav>
      <div class="cms-rail__foot">
        <div class="cms-rail__status">
          <strong>{hostedDemo ? "Disposable demo" : "Project files"}</strong>
          <span>{hostedDemo ? "This tab · resets on reload" : "Local filesystem · zudo-composer"}</span>
        </div>
      </div>
      <Dialog open={computed(() => rename.value !== null)} title="Rename pin" onClose={() => { rename.value = null; }}><form on:submit={(event) => { event.preventDefault(); const next = label.value.trim(); if (!next) return; const renaming = rename.value; onPinsChange?.(pinList.value.map((pin) => pin === renaming ? { ...pin, label: next } : pin)); rename.value = null; }}><label>Pin label<input modelValue={label} maxlength={120} required /></label><Button type="submit">Save label</Button></form></Dialog>
    </div>
  );
}

function RailActions({ label, children }: { label: string; children: Child }) {
  const trigger: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(trigger, { align: "start" });
  return <><button ref={trigger} type="button" class="cms-btn cms-btn--ghost cms-rail__actions" aria-label={label} {...menu.triggerProps}>···</button><Menu controller={menu} label={label}>{children}</Menu></>;
}
