// CMS overlay primitives (issue #159): the one Menu and the one Dialog every
// route uses. Import from this module — it carries the presentation with it.
import "./overlay.css";

export {
  computeMenuPosition,
  MENU_GAP,
  MENU_MIN_HEIGHT,
  MENU_VIEWPORT_MARGIN,
  type MenuAlign,
  type MenuAnchorRect,
  type MenuPlacement,
  type MenuPosition,
  type MenuSide,
  type MenuSize,
  type MenuViewport,
} from "./menu-position";
export {
  useMenu,
  type CloseMenuOptions,
  type MenuController,
  type MenuFocusIntent,
  type MenuTriggerProps,
  type MenuTriggerRef,
  type UseMenuOptions,
} from "./use-menu";
export {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuRadioItem,
  MenuSection,
  MenuSeparator,
  type MenuCheckedItemProps,
  type MenuItemProps,
  type MenuProps,
  type MenuRowProps,
  type MenuSectionProps,
} from "./menu";
export { OverlayPortal, type OverlayPortalProps } from "./portal";
export { Dialog, type DialogProps, type DialogSize } from "./dialog";
export { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";
