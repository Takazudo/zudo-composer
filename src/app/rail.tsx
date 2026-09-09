import type { ComponentChildren, JSX } from "preact";
import { useId, useRef, useState } from "preact/hooks";
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
import { Dialog, Menu, MenuItem, useMenu } from "../components/overlay";
import { formatIntent } from "./route-intents";
import { pinAvailable, type NavigationModel, type NavigationPin } from "./navigation-preferences";
import type { WorkspaceCounts } from "./workspace-summary";

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
   * A destination rendered outside the CMS chrome. `App` returns SiteDelivery
   * before the Shell mounts on `/site*`, so this entry can never be the current
   * route: it is a plain full-page link out of the application, marked with an
   * external glyph and never given `aria-current`.
   */
  readonly external?: true;
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
        label: "Website preview",
        href: "/website-preview",
        icon: PageIcon,
        accessibleName: "Website preview — choose preview source",
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
  return RAIL_ITEMS.find((item) => !item.external && item.href === normalized.split("?")[0]) ?? null;
}

export interface RailProps {
  hostedDemo?: boolean;
  path: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  counts?: RailCounts;
  models?: readonly NavigationModel[];
  modelError?: string | null;
  pins?: readonly NavigationPin[];
  onPinsChange?: (pins: NavigationPin[]) => void;
  onBrowse?: () => void;
  onNavigate?: (href: string) => void;
  hideToggle?: boolean;
}
export function Rail({ path, collapsed, onToggleCollapsed, counts = {}, models = [], modelError, pins = [], onPinsChange, onBrowse, onNavigate, hideToggle, hostedDemo = false }: RailProps): JSX.Element {
  const current = currentRailItem(path);
  const navId = `cms-rail-nav-${useId()}`;
  const [contentOpen, setContentOpen] = useState(true);
  const [rename, setRename] = useState<NavigationPin | null>(null);
  const [label, setLabel] = useState("");
  const navigate = (event: JSX.TargetedMouseEvent<HTMLAnchorElement>, href: string) => {
    if (!onNavigate || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(href);
  };
  const addPin = (pin: NavigationPin) => {
    if (!pins.some((value) => formatIntent(value.target) === formatIntent(pin.target))) onPinsChange?.([...pins, pin]);
  };
  return (
    <div class="cms-rail" data-compact={collapsed}>
      <a class="cms-rail__brand" href="/" onClick={(event) => navigate(event, "/")}>
        <span class="cms-rail__logo" aria-hidden="true">Z</span>
        <span class="cms-rail__brand-name">zudo-composer</span>
      </a>
      {!hideToggle && <div class="cms-rail__toolbar"><DisclosureButton expanded={!collapsed} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} aria-controls={navId} onClick={onToggleCollapsed} class="cms-rail__collapse" />{collapsed && onBrowse && <Button size="xs" variant="ghost" onClick={onBrowse} aria-label="Browse navigation">Browse</Button>}</div>}
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
                const count = counts[item.id];
                return (
                  <li key={item.id}>
                    <div class="cms-rail__row">
                    {!collapsed && item.id === "content" && <DisclosureButton expanded={contentOpen} aria-label={contentOpen ? "Collapse Content models" : "Expand Content models"} onClick={() => setContentOpen(!contentOpen)} size="xs" variant="ghost" />}
                    <a
                      class="cms-rail__item"
                      href={item.href}
                      onClick={(event) => navigate(event, item.href)}
                      data-route={item.id}
                      aria-current={current?.id === item.id ? "page" : undefined}
                      aria-label={item.accessibleName ?? item.label}
                      title={collapsed ? item.label : undefined}
                    >
                      <ItemIcon size="sm" class="cms-rail__icon" />
                      <span class="cms-rail__label">{item.label}</span>
                      {item.external ? (
                        <ExternalLinkIcon size="xs" class="cms-rail__external" />
                      ) : count === undefined ? null : (
                        // Decorative: the count repeats what the route itself
                        // shows, and reading it into the link name would make
                        // every item announce as "Content 2".
                        <span class="cms-rail__count" aria-hidden="true">{count}</span>
                      )}
                    </a>
                    </div>
                    {!collapsed && item.id === "content" && contentOpen && <ul class="cms-rail__tree" aria-label="Content models">
                      {modelError && <li role="status">{modelError}</li>}
                      {models.map((model) => {
                        const target = { route: "content" as const, providerId: model.providerId, modelId: model.modelId };
                        const href = formatIntent(target);
                        return <li key={href}><div class="cms-rail__row"><a href={href} class="cms-rail__model" onClick={(event) => navigate(event, href)} title={`${model.label} · ${model.providerId} · ${model.kind === "single" ? "Singleton" : "Collection"}`} aria-current={path === href ? "page" : undefined}>{model.label}</a><RailActions label={`${model.label} actions`}><MenuItem onSelect={() => addPin({ label: model.label, target })}>Pin model</MenuItem>{model.views.map((view) => <MenuItem key={view.id} onSelect={() => addPin({ label: view.label, target: { ...target, viewId: view.id } })}>Pin {view.label}</MenuItem>)}</RailActions></div></li>;
                      })}
                    </ul>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!collapsed && pins.length > 0 && <div class="cms-rail__group"><div class="cms-rail__section">Pinned views</div><ul class="cms-rail__items" aria-label="Pinned views">{pins.map((pin, index) => {
          const href = formatIntent(pin.target), available = pinAvailable(pin, models);
          const move = (offset: number) => { const next = [...pins]; [next[index], next[index + offset]] = [next[index + offset]!, next[index]!]; onPinsChange?.(next); };
          return <li class="cms-rail__row" key={href}>{available ? <a class="cms-rail__model" href={href} onClick={(event) => navigate(event, href)}>{pin.label}</a> : <span class="cms-rail__model" title="This model or view is unavailable">{pin.label} · unavailable</span>}<RailActions label={`${pin.label} pin actions`}><MenuItem onSelect={() => { setRename(pin); setLabel(pin.label); }}>Rename pin</MenuItem><MenuItem disabled={index === 0} onSelect={() => move(-1)}>Move up</MenuItem><MenuItem disabled={index === pins.length - 1} onSelect={() => move(1)}>Move down</MenuItem><MenuItem onSelect={() => onPinsChange?.(pins.filter((value) => value !== pin))}>Remove pin</MenuItem></RailActions></li>;
        })}</ul></div>}
      </nav>
      <div class="cms-rail__foot">
        <div class="cms-rail__status">
          <strong>{hostedDemo ? "Disposable demo" : "Project files"}</strong>
          <span>{hostedDemo ? "This tab · resets on reload" : "Local filesystem · zudo-composer"}</span>
        </div>
      </div>
      <Dialog open={rename !== null} title="Rename pin" onClose={() => setRename(null)}><form onSubmit={(event) => { event.preventDefault(); if (!label.trim()) return; onPinsChange?.(pins.map((pin) => pin === rename ? { ...pin, label: label.trim() } : pin)); setRename(null); }}><label>Pin label<input value={label} maxLength={120} required onInput={(event) => setLabel(event.currentTarget.value)} /></label><Button type="submit">Save label</Button></form></Dialog>
    </div>
  );
}

function RailActions({ label, children }: { label: string; children: ComponentChildren }): JSX.Element {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(trigger, { align: "start" });
  return <><button ref={trigger} type="button" class="cms-btn cms-btn--ghost cms-rail__actions" aria-label={label} {...menu.triggerProps}>···</button><Menu controller={menu} label={label}>{children}</Menu></>;
}
