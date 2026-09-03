import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  BellIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DarkThemeIcon,
  LightThemeIcon,
  MailIcon,
  SystemThemeIcon,
  XMarkIcon,
  type IconComponent,
} from "../components/icons";
import { Menu, MenuRadioItem, useMenu } from "../components/overlay";
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

export function Breadcrumb({ items }: { items: readonly BreadcrumbItem[] }): JSX.Element | null {
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

function ThemeMenu({ controller, snapshot }: { controller: ThemeController; snapshot: ThemeSnapshot }): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(triggerRef, { align: "end" });
  const current = THEME_OPTIONS.find((option) => option.preference === snapshot.preference) ?? THEME_OPTIONS[0]!;
  const CurrentIcon = current.icon;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        class="cms-btn cms-btn--ghost cms-topbar__control"
        aria-label={`Theme: ${current.label}`}
        {...menu.triggerProps}
      >
        <CurrentIcon size="sm" />
        <span class="cms-topbar__control-label">{current.label}</span>
        <ChevronDownIcon size="xs" />
      </button>
      <Menu controller={menu} label="Theme preference">
        {THEME_OPTIONS.map((option) => (
          <MenuRadioItem
            key={option.preference}
            checked={option.preference === snapshot.preference}
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
function NotificationDisclosure(): JSX.Element {
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
        class="cms-btn cms-btn--ghost cms-btn--icon cms-topbar__control"
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="app-notifications-panel"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <BellIcon size="sm" />
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

export interface TopbarProps {
  breadcrumb: readonly BreadcrumbItem[];
  editorStatus: EditorStatus | null;
  themeController: ThemeController;
  themeSnapshot: ThemeSnapshot;
}

export function Topbar({ breadcrumb, editorStatus, themeController, themeSnapshot }: TopbarProps): JSX.Element {
  return (
    <header class="cms-topbar">
      <Breadcrumb items={breadcrumb} />
      {editorStatus ? (
        <StatusChip
          class="cms-topbar__status"
          state={editorStatus.state}
          {...(editorStatus.detail === undefined ? {} : { detail: editorStatus.detail })}
          {...(editorStatus.onRetry === undefined ? {} : { onRetry: editorStatus.onRetry })}
        />
      ) : null}
      <div class="cms-topbar__right">
        <ThemeMenu controller={themeController} snapshot={themeSnapshot} />
        <NotificationDisclosure />
      </div>
    </header>
  );
}
