import { computed, For, Show, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import type { VersionedAssetStore } from "../../../../assets/library";
import { toSignal, type MaybeSignal } from "../../../../components/reactive";
import type { ComponentDefinition, ComposerComponentProvider } from "../../active-pack";
import { ChooserThumb, type ChooserThumbProps } from "./chooser-thumb";

interface ChooserCardGridProps {
  entries: MaybeSignal<readonly ComponentDefinition[]>;
  componentProvider: ComposerComponentProvider;
  catalogById: ReadonlyMap<string, ComponentDefinition>;
  /** Kinds that restrict one of their own slots, badged under a restricted target. */
  ownRuleIds?: MaybeSignal<ReadonlySet<string> | undefined>;
  onPreview: (id: string) => void;
  onConfirm: (id: string) => void;
  location?: ChooserThumbProps["location"];
  assetStore?: VersionedAssetStore;
}

export function ChooserCardGrid({ entries, componentProvider, catalogById, ownRuleIds, onPreview, onConfirm, location, assetStore }: ChooserCardGridProps): Child {
  const scrollerRef: Ref<HTMLUListElement> = { current: null };
  const list = toSignal(entries);
  const ruleIds = toSignal(ownRuleIds);
  return <ul ref={scrollerRef} class="sg-composer-chooser-grid">
    <For each={list} by={(entry) => entry.id}>
      {(entrySignal, indexSignal) => {
        const entry = entrySignal.value;
        return <li class="sg-composer-chooser-tile">
          <ChooserThumb entry={entry} index={indexSignal} componentProvider={componentProvider} catalogById={catalogById} scrollerRef={scrollerRef} location={location} assetStore={assetStore} />
          <button type="button" class="sg-composer-chooser-tile-button" data-chooser-result
            aria-label={entry.title} aria-describedby={`${entry.id}-meta`}
            on:click={() => onConfirm(entry.id)} on:mouseenter={() => onPreview(entry.id)} on:focus={() => onPreview(entry.id)}>
            {entry.title}
          </button>
          <span id={`${entry.id}-meta`} class="sg-composer-chooser-tile-meta">
            <span class="sg-composer-chooser-tile-category">
              {entry.category}
              <Show when={computed(() => ruleIds.value?.has(entry.id) ?? false)}>{() => <span class="sg-composer-chooser-rule-badge">rule</span>}</Show>
            </span>
            <span class="sg-composer-chooser-tile-description">{entry.description}</span>
          </span>
        </li>;
      }}
    </For>
  </ul>;
}
