import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import {
  BooleanIcon,
  ChevronDownIcon,
  ColorIcon,
  DateIcon,
  LongTextIcon,
  MarkdownIcon,
  NumberIcon,
  SlugIcon,
  TextIcon,
  UrlIcon,
  type IconComponent,
} from "../../components/icons";
import { Menu, MenuRadioItem, MenuSection, useMenu } from "../../components/overlay";
import { Button } from "../../components/ui";
import type { ContentFieldKind } from "../../content";

export interface ContentFieldKindPresentation {
  kind: ContentFieldKind;
  label: string;
  explanation: string;
  icon: IconComponent;
}

export const CONTENT_FIELD_KIND_PRESENTATIONS: readonly ContentFieldKindPresentation[] = [
  { kind: "text", label: "Short text", explanation: "A single line for names, titles, and concise copy.", icon: TextIcon },
  { kind: "long-text", label: "Long text", explanation: "Plain multi-line text without formatting markup.", icon: LongTextIcon },
  { kind: "markdown", label: "Rich text", explanation: "Formatting-assisted Markdown for structured editorial copy.", icon: MarkdownIcon },
  { kind: "number", label: "Number", explanation: "A numeric value for quantities, scores, and measurements.", icon: NumberIcon },
  { kind: "boolean", label: "Yes or no", explanation: "A two-state choice such as published or featured.", icon: BooleanIcon },
  { kind: "date", label: "Date", explanation: "A calendar date without a time of day.", icon: DateIcon },
  { kind: "slug", label: "Slug", explanation: "URL-friendly text for readable paths and identifiers.", icon: SlugIcon },
  { kind: "color", label: "Color", explanation: "A browser color value selected with a native color control.", icon: ColorIcon },
  { kind: "url", label: "URL", explanation: "A web address validated by the browser.", icon: UrlIcon },
] as const;

const FALLBACK_PRESENTATION = CONTENT_FIELD_KIND_PRESENTATIONS[0]!;

export function contentFieldKindPresentation(kind: ContentFieldKind): ContentFieldKindPresentation {
  return CONTENT_FIELD_KIND_PRESENTATIONS.find((presentation) => presentation.kind === kind) ?? FALLBACK_PRESENTATION;
}

export interface FieldKindPickerProps {
  value: ContentFieldKind;
  /** Stored Entries hold values for this field, so its type can no longer change. */
  locked?: boolean;
  /** Accessible name for the trigger, e.g. "Type for Title". */
  label: string;
  onChange(kind: ContentFieldKind): void;
}

/** Why a locked field's other types are unreachable, said where the author looks. */
const LOCKED_TITLE = "Type locked · stored Entries use it";
const LOCKED_REASON = "Type is immutable because stored Entries hold values for this field. Remove those values, or add a new field, to use another type.";

/**
 * The field-type control: one chip-shaped trigger opening a `Menu` of the nine
 * kinds, each with the sentence that says what it is for.
 *
 * It replaced a nine-card inline radiogroup. Nine cards cost a whole screen per
 * field in a schema that is itself a list of fields, and the popover carries the
 * same information — icon, friendly name, explanation, the current choice — in
 * the space of the chip that names the type in the row.
 */
export function FieldKindPicker({ value, locked = false, label, onChange }: FieldKindPickerProps): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(triggerRef, { align: "start" });
  const { label: currentLabel, icon: CurrentIcon } = contentFieldKindPresentation(value);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        class="sg-content-kind-trigger"
        elementRef={triggerRef}
        aria-label={label}
        title={locked ? LOCKED_REASON : undefined}
        data-locked={locked || undefined}
        {...menu.triggerProps}
      >
        <CurrentIcon size="xs" />
        {currentLabel}
        <ChevronDownIcon size="xs" class="sg-content-kind-trigger__caret" />
      </Button>
      <Menu controller={menu} label={label} class="sg-content-kind-menu">
        <MenuSection title={locked ? LOCKED_TITLE : "Field type"}>
          {CONTENT_FIELD_KIND_PRESENTATIONS.map(({ kind, label: friendlyLabel, explanation, icon: Icon }) => (
            <MenuRadioItem
              key={kind}
              checked={kind === value}
              // The chosen kind stays selectable so the menu always has one
              // focusable row; re-picking it is a no-op.
              disabled={locked && kind !== value}
              // `disabled` stops a pointer, not a synthesised activation, and
              // the controller answers a locked change by throwing — so the
              // refusal is stated here too rather than left to the attribute.
              onSelect={() => { if (!locked && kind !== value) onChange(kind); }}
            >
              <span class="sg-content-kind-option">
                <Icon size="sm" class="sg-content-kind-option__icon" />
                <span>
                  <strong>{friendlyLabel}</strong>
                  <small>{explanation}</small>
                </span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuSection>
      </Menu>
    </>
  );
}
