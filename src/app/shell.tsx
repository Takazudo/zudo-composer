import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  BellIcon,
  ChevronDownIcon,
  ComposerIcon,
  ContentIcon,
  HomeIcon,
  LightThemeIcon,
  DarkThemeIcon,
  MappingIcon,
  MailIcon,
  FolderIcon,
  SitemapperIcon,
  SystemThemeIcon,
  XMarkIcon,
} from "../components/icons";
import type { IconComponent } from "../components/icons";
import type { ThemeController, ThemePreference, ThemeSnapshot } from "../theme/theme";

export interface AppRoute {
  readonly label: string;
  readonly href: string;
  readonly description: string;
  readonly icon: IconComponent;
}

/** The shared route vocabulary used by both the header and the Home cards. */
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

const THEME_OPTIONS: readonly {
  readonly preference: ThemePreference;
  readonly label: string;
  readonly icon: IconComponent;
}[] = [
  { preference: "system", label: "System", icon: SystemThemeIcon },
  { preference: "light", label: "Light", icon: LightThemeIcon },
  { preference: "dark", label: "Dark", icon: DarkThemeIcon },
] as const;

function themeOptionIndex(preference: ThemePreference): number {
  return THEME_OPTIONS.findIndex((option) => option.preference === preference);
}

function ThemeMenu({ controller, snapshot }: { controller: ThemeController; snapshot: ThemeSnapshot }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => themeOptionIndex(snapshot.preference));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = themeOptionIndex(snapshot.preference);

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const nextIndex = selectedIndex < 0 ? 0 : selectedIndex;
    setActiveIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("click", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("click", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, selectedIndex]);

  const openMenu = (): void => setOpen(true);
  const choose = (preference: ThemePreference): void => {
    controller.setPreference(preference);
    close();
  };
  const move = (index: number): void => {
    const nextIndex = (index + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    setActiveIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  };

  const currentOption = THEME_OPTIONS[selectedIndex < 0 ? 0 : selectedIndex]!;
  const CurrentIcon = currentOption.icon;

  return (
    <div class="app-disclosure app-theme-disclosure">
      <button
        ref={triggerRef}
        type="button"
        class="app-header-control app-theme-trigger"
        aria-label={`Theme: ${currentOption.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="app-theme-menu"
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
          event.preventDefault();
          openMenu();
        }}
      >
        <CurrentIcon size="sm" />
        <span class="app-header-control__label">Theme</span>
        <span class="app-theme-trigger__current">{currentOption.label}</span>
        <ChevronDownIcon size="xs" />
      </button>
      {open && (
        <div ref={menuRef} id="app-theme-menu" class="app-popover app-theme-menu" role="menu" aria-label="Theme preference">
          {THEME_OPTIONS.map((option, index) => {
            const OptionIcon = option.icon;
            const selected = option.preference === snapshot.preference;
            return (
              <button
                ref={(element) => { optionRefs.current[index] = element; }}
                key={option.preference}
                type="button"
                role="menuitemradio"
                class="app-theme-option"
                data-selected={selected ? "true" : undefined}
                aria-checked={selected}
                tabIndex={activeIndex === index ? 0 : -1}
                onClick={() => choose(option.preference)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    move(index + 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    move(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    move(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    move(THEME_OPTIONS.length - 1);
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(option.preference);
                  }
                }}
              >
                <OptionIcon size="sm" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotificationDisclosure() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("click", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("click", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div class="app-disclosure app-notification-disclosure">
      <button
        ref={triggerRef}
        type="button"
        class="app-header-control app-notification-trigger"
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="app-notifications-panel"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <BellIcon size="sm" />
        <span class="app-header-control__label">Notifications</span>
      </button>
      {open && (
        <section ref={panelRef} id="app-notifications-panel" class="app-popover app-notification-panel" role="dialog" aria-labelledby="app-notifications-title">
          <header class="app-notification-panel__header">
            <div>
              <p class="app-notification-panel__eyebrow">Workspace signals</p>
              <h2 id="app-notifications-title">Notifications</h2>
            </div>
            <button ref={closeRef} type="button" class="app-icon-button" aria-label="Close notifications" onClick={close}>
              <XMarkIcon size="sm" />
            </button>
          </header>
          <p class="app-notification-panel__intro">This standalone workspace runs in your browser. Delivery services are not connected.</p>
          <div class="app-notification-channel" data-notification-state="planned">
            <div class="app-notification-channel__heading">
              <MailIcon size="sm" />
              <strong>Email</strong>
              <span class="app-status-label">Planned</span>
            </div>
            <p id="app-email-planned-copy">Email delivery is planned. This local browser app cannot send email yet, so no address is collected.</p>
            <label class="app-disabled-control">
              <input type="checkbox" disabled aria-describedby="app-email-planned-copy" />
              <span>Send email alerts</span>
            </label>
            <button type="button" class="app-disabled-control app-notification-configure" disabled>Configure email delivery</button>
          </div>
        </section>
      )}
    </div>
  );
}

export function Shell({
  children,
  path,
  themeController,
  themeSnapshot,
}: {
  children: ComponentChildren;
  path: string;
  themeController: ThemeController;
  themeSnapshot: ThemeSnapshot;
}) {
  return (
    <div class="app-shell">
      <header class="app-header">
        <a class="app-brand" href="/">zudo-composer</a>
        <nav class="app-header__nav" aria-label="Main navigation">
          {APP_ROUTES.map((route) => {
            const RouteIcon = route.icon;
            return (
              <a
                key={route.href}
                class="app-route-link"
                href={route.href}
                data-route={route.href === "/" ? "home" : route.href.slice(1)}
                aria-current={path === route.href || (route.href === "/" && path === "") ? "page" : undefined}
                title={route.description}
              >
                <RouteIcon size="sm" class="app-route-icon" />
                <span class="app-route-label">{route.label}</span>
              </a>
            );
          })}
        </nav>
        <div class="app-header__controls">
          <ThemeMenu controller={themeController} snapshot={themeSnapshot} />
          <NotificationDisclosure />
        </div>
      </header>
      {children}
    </div>
  );
}
