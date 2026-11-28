import { computed, getScope, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import {
  BellIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DarkThemeIcon,
  LightThemeIcon,
  SystemThemeIcon,
  XMarkIcon,
  type IconComponent,
} from "../components/icons";
import { createMenu, Menu, MenuRadioItem } from "../components/overlay";
import { read, toSignal, type MaybeSignal } from "../components/reactive";
import { Rebuild } from "../components/rebuild";
import { StatusChip } from "../components/ui";
import type { BreadcrumbItem, EditorStatus } from "./chrome-context";
import type { ThemeController, ThemePreference, ThemeSnapshot } from "../theme/theme";

// The shell topbar (issue #161): one 48px bar for every route. The breadcrumb
// and the save-status chip are published by the route through `chrome-context`;
// the theme control and the notifications disclosure belong to the application.

const THEME_OPTIONS: readonly {
  readonly preference: ThemePreference;
  readonly label: string;
  readonly icon: IconComponent;
}[] = [
  { preference: "system", label: "System", icon: SystemThemeIcon },
  { preference: "light", label: "Light", icon: LightThemeIcon },
  { preference: "dark", label: "Dark", icon: DarkThemeIcon },
] as const;

function Breadcrumb({ items }: { items: readonly BreadcrumbItem[] }): Child {
  if (items.length === 0) return null;
  return (
    <nav class="cms-crumbs" aria-label="Breadcrumb">
      <ol class="cms-crumbs__list">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} class="cms-crumbs__item">
              {index > 0 ? <ChevronRightIcon size="xs" class="cms-crumbs__sep" /> : null}
              {item.href !== undefined && !last ? (
                <a class="cms-crumbs__link" href={item.href}>{item.label}</a>
              ) : (
                <span class="cms-crumbs__current" aria-current={last ? "page" : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ThemeMenu({ controller, snapshot }: { controller: ThemeController; snapshot: MaybeSignal<ThemeSnapshot> }): Child {
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(triggerRef, { align: "end" });
  const current = computed(() => THEME_OPTIONS.find((option) => option.preference === read(snapshot).preference) ?? THEME_OPTIONS[0]!);

  return (
    <>
      {/* `createMenu` needs the trigger's element to anchor and restore focus,
          so the trigger wears the button classes directly. */}
      <button
        ref={triggerRef}
        type="button"
        class="cms-btn cms-btn--ghost cms-topbar__control"
        aria-label={computed(() => `Theme: ${current.value.label}`)}
        {...menu.triggerProps}
      >
        <Rebuild value={computed(() => current.value.icon)}>{(CurrentIcon) => <CurrentIcon size="sm" />}</Rebuild>
        <span class="cms-topbar__control-label">{computed(() => current.value.label)}</span>
        <ChevronDownIcon size="xs" />
      </button>
      <Menu controller={menu} label="Theme preference">
        {THEME_OPTIONS.map((option) => (
          <MenuRadioItem
            key={option.preference}
            checked={computed(() => option.preference === current.value.preference)}
            onSelect={() => controller.setPreference(option.preference)}
          >
            {option.label}
          </MenuRadioItem>
        ))}
      </Menu>
    </>
  );
}

/**
 * Unchanged from the retired header: the workspace runs in one browser with no
 * delivery service behind it, so this panel states what is planned rather than
 * collecting an address it could not use.
 */
function NotificationDisclosure(): Child {
  const open = signal(false);
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const panelRef: Ref<HTMLElement> = { current: null };
  const closeRef: Ref<HTMLButtonElement> = { current: null };

  const close = (restore = true): void => {
    open.value = false;
    if (restore) triggerRef.current?.focus();
  };

  function Panel(): Child {
    getScope().onActivate(() => {
      closeRef.current?.focus();
      const onPointerDown = (event: PointerEvent): void => {
        const target = event.target as Node;
        if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
        close(false);
      };
      const onMouseDown = (event: MouseEvent): void => {
        const target = event.target as Node;
        if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
        close(false);
      };
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
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
    });
    return (
      <section ref={panelRef} id="app-notifications-panel" class="app-popover app-notification-panel" role="dialog" aria-labelledby="app-notifications-title">
        <header class="app-notification-panel__header">
          <div>
            <p class="app-notification-panel__eyebrow">Workspace signals</p>
            <h2 id="app-notifications-title">Notifications</h2>
          </div>
          <button ref={closeRef} type="button" class="app-icon-button" aria-label="Close notifications" on:click={() => close()}>
            <XMarkIcon size="sm" />
          </button>
        </header>
        <p class="app-notification-panel__intro">This standalone workspace runs in your browser. Composer never sends email or other notifications; the host project owns delivery.</p>
      </section>
    );
  }

  return (
    <div class="app-disclosure app-notification-disclosure">
      <button
        ref={triggerRef}
        type="button"
        class="cms-btn cms-btn--ghost cms-btn--icon cms-topbar__control"
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={computed(() => (open.value ? "true" : "false"))}
        aria-controls="app-notifications-panel"
        on:click={() => {
          if (open.value) close();
          else open.value = true;
        }}
      >
        <BellIcon size="sm" />
      </button>
      <Show when={open}>{() => <Panel />}</Show>
    </div>
  );
}

export interface TopbarProps {
  navigationControl?: Child;
  breadcrumb: MaybeSignal<readonly BreadcrumbItem[]>;
  editorStatus: MaybeSignal<EditorStatus | null>;
  themeController: ThemeController;
  themeSnapshot: MaybeSignal<ThemeSnapshot>;
}

export function Topbar({ breadcrumb, editorStatus, themeController, themeSnapshot, navigationControl }: TopbarProps): Child {
  const status = toSignal(editorStatus);
  return (
    <header class="cms-topbar">
      {navigationControl}
      <Rebuild value={toSignal(breadcrumb)}>{(items) => <Breadcrumb items={items} />}</Rebuild>
      <Rebuild value={status}>
        {(current) =>
          current ? (
            <StatusChip
              class="cms-topbar__status"
              state={current.state}
              {...(current.detail === undefined ? {} : { detail: current.detail })}
              {...(current.onRetry === undefined ? {} : { onRetry: current.onRetry })}
            />
          ) : null
        }
      </Rebuild>
      <div class="cms-topbar__right">
        <ThemeMenu controller={themeController} snapshot={themeSnapshot} />
        <NotificationDisclosure />
      </div>
    </header>
  );
}
