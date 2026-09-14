/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Rule presentation for a chooser opened on a restricted insertion target:
// the header naming what the region accepts, the hidden-by-rule disclosure,
// and the note explaining why a hidden component is not offered. Every piece
// renders from one `SlotRule` (`../slot-rules`), so an open target renders none.

import type { JSX } from "preact";
import type { RootPolicyOrigin } from "../../../../composer/browser";
import type { SlotRule, SlotRuleComponent } from "../slot-rules";
import { Chip } from "../../../../components/ui";

export function ruleOriginPath(origin: RootPolicyOrigin): string {
  return `${origin.componentTitle} › ${origin.slotLabel}`;
}

/** The chooser's blocked text: a full slot reads by its bound, anything else keeps the rule's reason. */
export function chooserBlockedMessage(rule: SlotRule): string | null {
  if (!rule.full) return rule.blockedReason;
  if (rule.cardinality === "single" || rule.max === undefined) return "This slot already has a component.";
  return `This slot is full (max ${rule.max}).`;
}

function LockGlyph(): JSX.Element {
  return (
    <svg class="sg-composer-chooser-rule-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <rect x="3.25" y="7" width="9.5" height="6.75" rx="1.25" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  );
}

export function ChooserRuleHeader({ rule }: { rule: SlotRule }): JSX.Element {
  const count = rule.accepts.length;
  return (
    <div class="sg-composer-chooser-rule" data-chooser-rule>
      <LockGlyph />
      <span class="sg-composer-chooser-rule-lead">
        This region accepts {count} {count === 1 ? "kind" : "kinds"}
      </span>
      <ul class="sg-composer-chooser-rule-chips" aria-label="Allowed components">
        {rule.accepts.map((component) => (
          <li key={component.id}>
            <Chip tone="accent">{component.title}</Chip>
          </li>
        ))}
      </ul>
      {rule.origin && (
        <span class="sg-composer-chooser-rule-source">
          rule from {ruleOriginPath(rule.origin)}
          {rule.origin.viaTemplate && ` · template ${rule.origin.viaTemplate.sourceName}`}
        </span>
      )}
    </div>
  );
}

export interface ChooserHiddenDisclosureProps {
  rule: SlotRule;
  components: readonly SlotRuleComponent[];
  open: boolean;
  onToggle: (open: boolean) => void;
  previewedId: string | null;
  onPreview: (id: string) => void;
}

export function ChooserHiddenDisclosure({ rule, components, open, onToggle, previewedId, onPreview }: ChooserHiddenDisclosureProps): JSX.Element {
  const where = rule.origin ? ruleOriginPath(rule.origin) : "this region";
  return (
    <details
      class="sg-composer-chooser-hidden"
      open={open}
      onToggle={(event) => onToggle((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary class="sg-composer-chooser-hidden-summary">
        {components.length} hidden by this region's rule — shown so you know they exist, not offered
      </summary>
      <ul class="sg-composer-chooser-hidden-list">
        {components.map((component) => (
          <li key={component.id}>
            <button
              type="button"
              class="sg-composer-chooser-hidden-row"
              aria-label={component.title}
              aria-describedby={`${component.id}-hidden-meta`}
              aria-pressed={previewedId === component.id}
              onClick={() => onPreview(component.id)}
              onMouseEnter={() => onPreview(component.id)}
              onFocus={() => onPreview(component.id)}
            >
              <span class="sg-composer-chooser-hidden-title" aria-hidden="true">{component.title}</span>
              <span id={`${component.id}-hidden-meta`} class="sg-composer-chooser-hidden-meta">
                <span class="sg-composer-chooser-hidden-category">{component.category}</span>
                <span class="sg-composer-chooser-hidden-where">not in {where}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Why a hidden component is not offered, and where an author would change that. */
export function hiddenComponentNote(rule: SlotRule, regionLabel: string, component: SlotRuleComponent): string {
  const titles = rule.accepts.map((accepted) => accepted.title).join(", ");
  const origin = rule.origin;
  const path = origin ? ruleOriginPath(origin) : regionLabel;
  const region = regionLabel === path ? "This region" : regionLabel;
  const pages = origin?.viaTemplate?.sourceName ?? "these";
  return `Not offered here. ${region} is ${path}, which accepts ${titles}. `
    + `To allow ${component.title} on ${pages} pages, add \`${component.id}\` to that slot's \`accepts\` in the host's component source.`;
}
