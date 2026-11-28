import { computed, For, Show, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { CollectionIcon, PlusIcon, SearchIcon, SingleIcon } from "../../components/icons";
import { Rebuild } from "../../components/rebuild";
import { Button, Chip, EmptyState, Input, SegmentedControl } from "../../components/ui";
import type { ContentModelKind } from "../../content";
import type { ContentAuthoringController, ContentAuthoringState } from "./controller";

type ModelFilter = "all" | ContentModelKind;

export function ContentModelDirectory({ state, controller, run, onAddModel }: {
  state: ReadonlySignal<ContentAuthoringState>;
  controller: ContentAuthoringController;
  run(action: () => void | Promise<void>): void;
  onAddModel(): void;
}) {
  const query = signal("");
  const kind = signal<ModelFilter>("all");
  const models = computed(() => state.value.models.filter((model) => {
    if (kind.value !== "all" && model.kind !== kind.value) return false;
    return `${model.name} ${state.value.modelDescriptions[model.id] ?? ""} ${model.id}`.toLowerCase().includes(query.value.trim().toLowerCase());
  }));
  const totalEntries = computed(() => Object.values(state.value.entryCounts).reduce((total, count) => total + count, 0));
  const hasModels = computed(() => state.value.models.length > 0);

  return <div class="sg-content-directory">
    <header class="sg-content-directory__intro">
      <div><p class="sg-content-eyebrow">Workspace / Content</p><h2>All models</h2><p>Models describe reusable data. Entries hold the canonical values.</p></div>
      <div class="sg-content-directory__counts"><strong>{computed(() => state.value.models.length)}</strong><span>models</span><strong>{totalEntries}</strong><span>entries</span></div>
      <Button variant="primary" on:click={onAddModel}><PlusIcon size="sm" />Create model</Button>
    </header>
    <div class="sg-content-directory__toolbar">
      <SegmentedControl<ModelFilter> label="Model kind" value={kind} onChange={(next) => { kind.value = next; }} options={[
        { value: "all", label: "All models" }, { value: "collection", label: "Collections" }, { value: "single", label: "Singles" },
      ]} />
      <Input icon={SearchIcon} aria-label="Search models" placeholder="Find a model…" modelValue={query} />
    </div>
    <Show when={computed(() => models.value.length > 0)} fallback={() => <Rebuild value={hasModels}>{(some) => <EmptyState inline title={some ? "No models match" : "No Content models yet"} description={some ? "Try another search or model kind." : "Create a collection or singleton to define your first content shape."} action={some ? <Button on:click={() => { query.value = ""; kind.value = "all"; }}>Clear filters</Button> : <Button variant="primary" on:click={onAddModel}>Create model</Button>} />}</Rebuild>}>{() =>
      <div class="sg-content-model-grid"><For each={models} by={(model) => `${state.value.providerId}:${model.id}`}>{(model) => {
        const Icon = model.value.kind === "collection" ? CollectionIcon : SingleIcon;
        const id = model.value.id;
        return <button type="button" class="sg-content-model-card" on:click={() => run(() => controller.openModel(id))}>
          <span class="sg-content-model-card__heading"><Icon size="md" /><span><strong>{computed(() => model.value.name)}</strong><small>{computed(() => state.value.providerLabel)}</small></span><Chip class="sg-content-model-card__kind" tone="plain">{model.value.kind}</Chip></span>
          <span class="sg-content-model-card__description">{computed(() => state.value.modelDescriptions[id] || "No description yet.")}</span>
          <span class="sg-content-model-card__meta"><span>{computed(() => `${state.value.entryCounts[id] ?? 0} entries`)}</span><span>{computed(() => `${model.value.fieldCount} fields`)}</span></span>
        </button>;
      }}</For></div>
    }</Show>
  </div>;
}
