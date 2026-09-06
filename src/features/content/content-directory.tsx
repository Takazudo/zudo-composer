import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import { CollectionIcon, PlusIcon, SearchIcon, SingleIcon } from "../../components/icons";
import { Button, Chip, EmptyState, Input, SegmentedControl } from "../../components/ui";
import type { ContentModelKind } from "../../content";
import type { ContentAuthoringController, ContentAuthoringState } from "./controller";

type ModelFilter = "all" | ContentModelKind;

export function ContentModelDirectory({ state, controller, run, onAddModel }: {
  state: ContentAuthoringState;
  controller: ContentAuthoringController;
  run(action: () => void | Promise<void>): void;
  onAddModel(): void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ModelFilter>("all");
  const models = useMemo(() => state.models.filter((model) => {
    if (kind !== "all" && model.kind !== kind) return false;
    return `${model.name} ${state.modelDescriptions[model.id] ?? ""} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [kind, query, state.modelDescriptions, state.models]);
  const totalEntries = Object.values(state.entryCounts).reduce((total, count) => total + count, 0);

  return <div class="sg-content-directory">
    <header class="sg-content-directory__intro">
      <div><p class="sg-content-eyebrow">Workspace / Content</p><h2>All models</h2><p>Models describe reusable data. Entries hold the canonical values.</p></div>
      <div class="sg-content-directory__counts"><strong>{state.models.length}</strong><span>models</span><strong>{totalEntries}</strong><span>entries</span></div>
      <Button variant="primary" onClick={onAddModel}><PlusIcon size="sm" />Create model</Button>
    </header>
    <div class="sg-content-directory__toolbar">
      <SegmentedControl<ModelFilter> label="Model kind" value={kind} onChange={setKind} options={[
        { value: "all", label: "All models" }, { value: "collection", label: "Collections" }, { value: "single", label: "Singles" },
      ]} />
      <Input icon={SearchIcon} aria-label="Search models" placeholder="Find a model…" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
    </div>
    {models.length === 0 ? <EmptyState inline title={state.models.length ? "No models match" : "No Content models yet"} description={state.models.length ? "Try another search or model kind." : "Create a collection or singleton to define your first content shape."} action={state.models.length ? <Button onClick={() => { setQuery(""); setKind("all"); }}>Clear filters</Button> : <Button variant="primary" onClick={onAddModel}>Create model</Button>} /> :
      <div class="sg-content-model-grid">{models.map((model) => {
        const Icon = model.kind === "collection" ? CollectionIcon : SingleIcon;
        return <button class="sg-content-model-card" key={`${state.providerId}:${model.id}`} onClick={() => run(() => controller.openModel(model.id))}>
          <span class="sg-content-model-card__heading"><Icon size="md" /><span><strong>{model.name}</strong><small>{state.providerLabel}</small></span><Chip class="sg-content-model-card__kind" tone="plain">{model.kind}</Chip></span>
          <span class="sg-content-model-card__description">{state.modelDescriptions[model.id] || "No description yet."}</span>
          <span class="sg-content-model-card__meta"><span>{state.entryCounts[model.id] ?? 0} entries</span><span>{model.fieldCount} fields</span></span>
        </button>;
      })}</div>}
  </div>;
}
