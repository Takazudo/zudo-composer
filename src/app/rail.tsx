import type { JSX } from "preact";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
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
import { Button } from "../components/ui";
import type { WorkspaceCounts } from "./workspace-summary";

// The workspace rail (issue #161): the dark graphite sidebar that replaced the
// top navigation header, and the bottom tab strip the same markup becomes below
// 64rem. Grouping follows the prototype — one Dashboard entry, then the records
// an author writes, then the structures they are placed into.

export type RailItemId = "home" | "content" | "media" | "composer" | "mapping" | "sitemapper" | "site";

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
    items: [{ id: "home", label: "Dashboard", href: "/", icon: HomeIcon }],
  },
  {
    id: "author",
    label: "Author",
    items: [
      { id: "content", label: "Content", href: "/content", icon: ContentIcon },
      { id: "media", label: "Media", href: "/media", icon: FolderIcon },
    ],
  },
  {
    id: "structure",
    label: "Structure",
    items: [
      { id: "composer", label: "Compositions", href: "/composer", icon: ComposerIcon },
      { id: "mapping", label: "Mappings", href: "/mapping", icon: MappingIcon },
      { id: "sitemapper", label: "Sitemaps", href: "/sitemapper", icon: SitemapperIcon },
      {
        id: "site",
        label: "Site",
        href: "/site",
        icon: PageIcon,
        external: true,
        accessibleName: "Site — open the delivered site",
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
  if (counts.media.status === "ok") railCount.media = counts.media.value.assets;
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
  return RAIL_ITEMS.find((item) => !item.external && item.href === normalized) ?? null;
}

export interface RailProps {
  path: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  counts?: RailCounts;
}

const NAV_ID = "cms-rail-nav";

export function Rail({ path, collapsed, onToggleCollapsed, counts = {} }: RailProps): JSX.Element {
  const current = currentRailItem(path);
  return (
    <div class="cms-rail">
      <a class="cms-rail__brand" href="/">
        <span class="cms-rail__logo" aria-hidden="true">Z</span>
        <span class="cms-rail__brand-name">zudo-composer</span>
      </a>
      <nav id={NAV_ID} class="cms-rail__nav" aria-label="Main navigation">
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
                    <a
                      class="cms-rail__item"
                      href={item.href}
                      data-route={item.id}
                      aria-current={current?.id === item.id ? "page" : undefined}
                      aria-label={item.accessibleName}
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
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div class="cms-rail__foot">
        <div class="cms-rail__status">
          <strong>Browser storage</strong>
          <span>IndexedDB · zudo-composer</span>
        </div>
        <Button
          class="cms-rail__collapse"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={collapsed ? "false" : "true"}
          aria-controls={NAV_ID}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ArrowRightIcon size="sm" /> : <ArrowLeftIcon size="sm" />}
        </Button>
      </div>
    </div>
  );
}
