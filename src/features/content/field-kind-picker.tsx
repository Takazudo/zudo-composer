import type { JSX } from "preact";
import type { ContentFieldKind } from "../../content";
import {
  BooleanIcon,
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

export interface FieldKindPickerProps {
  value: ContentFieldKind;
  locked?: boolean;
  label?: string;
  onChange(kind: ContentFieldKind): void;
}

export function FieldKindPicker({ value, locked = false, label = "Field type", onChange }: FieldKindPickerProps): JSX.Element {
  const move = (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (locked || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const length = CONTENT_FIELD_KIND_PRESENTATIONS.length;
    const next = event.key === "Home" ? 0 : event.key === "End" ? length - 1 : (index + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + length) % length;
    const kind = CONTENT_FIELD_KIND_PRESENTATIONS[next]!.kind;
    onChange(kind);
    (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };

  return <div class="sg-content-kind-picker" role="radiogroup" aria-label={label} aria-disabled={locked || undefined}>
    {CONTENT_FIELD_KIND_PRESENTATIONS.map(({ kind, label: friendlyLabel, explanation, icon: Icon }, index) => {
      const selected = kind === value;
      const unavailable = locked && !selected;
      return <button
        key={kind}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-disabled={unavailable || undefined}
        tabIndex={selected ? 0 : -1}
        data-locked={locked || undefined}
        onClick={() => { if (!locked) onChange(kind); }}
        onKeyDown={(event) => move(event, index)}
      >
        <Icon size="lg" />
        <span><strong>{friendlyLabel}</strong><small>{explanation}</small><code>{kind}</code></span>
        {locked && selected && <em>In use · type locked</em>}
      </button>;
    })}
  </div>;
}
