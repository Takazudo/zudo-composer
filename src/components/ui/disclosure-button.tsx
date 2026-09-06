import { Button, type ButtonProps } from "./button";
import { cx } from "./class-names";

export type DisclosureButtonProps = Omit<ButtonProps, "children" | "iconOnly" | "aria-expanded"> & {
  expanded: boolean;
  "aria-label": string;
};

/** Shared square plus/minus expansion affordance, including shell disclosures. */
export function DisclosureButton({ expanded, class: className, ...props }: DisclosureButtonProps) {
  return (
    <Button {...props} iconOnly aria-expanded={expanded} class={cx("cms-disclosure", className)}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" />
        <path d="M5 8h6" />
        {expanded ? null : <path d="M8 5v6" />}
      </svg>
    </Button>
  );
}
