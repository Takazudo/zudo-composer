import type { ComponentChildren, JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  ComposerIcon,
  ContentIcon,
  FolderIcon,
  HomeIcon,
  MappingIcon,
  SitemapperIcon,
  type IconComponent,
} from "../components/icons";
import type { ThemeController, ThemeSnapshot } from "../theme/theme";
import { ChromeContext, createChromeStore, useChrome, type BreadcrumbItem } from "./chrome-context";
import {
  currentRailItem,
  persistRailState,
  Rail,
  railCounts,
  readRailState,
  type RailCounts,
  type RailState,
} from "./rail";
import { Topbar } from "./topbar";
import type { WorkspaceCounts, WorkspaceSummary } from "./workspace-summary";
import "./shell.css";

export interface AppRoute {
  readonly label: string;
  readonly href: string;
  readonly description: string;
  readonly icon: IconComponent;
}

/**
 * The card vocabulary the provisional Home route still renders. The rail owns
 * navigation now (`rail.tsx`); this list survives only until the Dashboard task
 * replaces Home, and nothing else should grow a dependency on it.
 */
export const APP_ROUTES: readonly AppRoute[] = [
  {
    label: "Home",
    href: "/",
    description: "See the authoring workspaces and choose where to start.",
    icon: HomeIcon,
  },
  {
    label: "Composer",
    href: "/composer",
    description: "Build reusable page structures from components.",
    icon: ComposerIcon,
  },
  {
    label: "Content",
    href: "/content",
    description: "Define content models and author the Entries they hold.",
    icon: ContentIcon,
  },
  {
    label: "Mapping",
    href: "/mapping",
    description: "Connect Content fields to Composition slots.",
    icon: MappingIcon,
  },
  {
    label: "Sitemapper",
    href: "/sitemapper",
    description: "Organize Compositions into navigable site routes.",
    icon: SitemapperIcon,
  },
  {
    label: "Media",
    href: "/media",
    description: "Browse project media and prepare references for authored content.",
    icon: FolderIcon,
  },
] as const;

export interface ShellProps {
  children: ComponentChildren;
  path: string;
  themeController: ThemeController;
  themeSnapshot: ThemeSnapshot;
  /** Feeds the rail's count slots. Omitted where no provider graph is mounted. */
  summary?: WorkspaceSummary;
}

/**
 * The application chrome: dark rail, breadcrumb topbar, route content.
 *
 * The Shell is the only consumer of `chrome-context`, so it supplies the
 * Provider a route publishes into. `/site*` never reaches here — `App` returns
 * SiteDelivery before the Shell mounts — which is why the rail's Site entry is
 * an external link that can never be the current route.
 */
export function Shell({ children, path, themeController, themeSnapshot, summary }: ShellProps): JSX.Element {
  const store = useMemo(createChromeStore, []);
  const [railState, setRailState] = useState<RailState>(readRailState);
  const [counts, setCounts] = useState<WorkspaceCounts | null>(null);

  useEffect(() => {
    if (!summary) return undefined;
    let live = true;
    void summary.counts().then((value) => {
      if (live) setCounts(value);
    });
    return () => { live = false; };
  }, [summary]);

  const toggleRail = (): void => {
    setRailState((current) => {
      const next: RailState = current === "collapsed" ? "expanded" : "collapsed";
      persistRailState(next);
      return next;
    });
  };

  const collapsed = railState === "collapsed";
  const rail: RailCounts = useMemo(() => railCounts(counts), [counts]);

  return (
    <ChromeContext.Provider value={store}>
      <div class="app-shell" data-rail={railState}>
        <Rail path={path} collapsed={collapsed} onToggleCollapsed={toggleRail} counts={rail} />
        <div class="cms-frame">
          <ShellTopbar path={path} themeController={themeController} themeSnapshot={themeSnapshot} />
          <div class="cms-shell-main">{children}</div>
        </div>
      </div>
    </ChromeContext.Provider>
  );
}

/**
 * Split out so `useChrome()` subscribes from inside the Provider: a hook called
 * in `Shell` itself would read the context above it and never see a publish.
 */
function ShellTopbar({
  path,
  themeController,
  themeSnapshot,
}: {
  path: string;
  themeController: ThemeController;
  themeSnapshot: ThemeSnapshot;
}): JSX.Element {
  const chrome = useChrome();
  const item = currentRailItem(path);
  // Every route shows at least where it is; a route that publishes its own
  // trail replaces this default rather than appending to it.
  const fallback: readonly BreadcrumbItem[] = useMemo(
    () => (item ? [{ label: item.label }] : [{ label: "Not found" }]),
    [item],
  );
  const breadcrumb = chrome.breadcrumb.length > 0 ? chrome.breadcrumb : fallback;
  return (
    <Topbar
      breadcrumb={breadcrumb}
      editorStatus={chrome.editorStatus}
      themeController={themeController}
      themeSnapshot={themeSnapshot}
    />
  );
}
