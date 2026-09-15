import { useRef } from "preact/hooks";
import type { ComponentDefinition, ComposerComponentProvider } from "../../active-pack";
import { ChooserThumb, type ChooserThumbProps } from "./chooser-thumb";

interface ChooserCardGridProps {
  entries: readonly ComponentDefinition[];
  componentProvider: ComposerComponentProvider;
  catalogById: ReadonlyMap<string, ComponentDefinition>;
  /** Kinds that restrict one of their own slots, badged under a restricted target. */
  ownRuleIds?: ReadonlySet<string>;
  onPreview: (id: string) => void;
  onConfirm: (id: string) => void;
  location?: ChooserThumbProps["location"];
}

export function ChooserCardGrid({ entries, componentProvider, catalogById, ownRuleIds, onPreview, onConfirm, location }: ChooserCardGridProps) {
  const scrollerRef = useRef<HTMLUListElement>(null);
  return <ul ref={scrollerRef} class="sg-composer-chooser-grid">
    {entries.map((entry, index) => <li key={entry.id} class="sg-composer-chooser-tile">
      <ChooserThumb entry={entry} index={index} componentProvider={componentProvider} catalogById={catalogById} scrollerRef={scrollerRef} location={location} />
      <button type="button" class="sg-composer-chooser-tile-button" data-chooser-result
        aria-label={entry.title} aria-describedby={`${entry.id}-meta`}
        onClick={() => onConfirm(entry.id)} onMouseEnter={() => onPreview(entry.id)} onFocus={() => onPreview(entry.id)}>
        {entry.title}
      </button>
      <span id={`${entry.id}-meta`} class="sg-composer-chooser-tile-meta">
        <span class="sg-composer-chooser-tile-category">
          {entry.category}
          {ownRuleIds?.has(entry.id) && <span class="sg-composer-chooser-rule-badge">rule</span>}
        </span>
        <span class="sg-composer-chooser-tile-description">{entry.description}</span>
      </span>
    </li>)}
  </ul>;
}
