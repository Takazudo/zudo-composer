import type { ComponentChildren, JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  ComposerIcon,
  ContentIcon,
  EntryIcon,
  ErrorIcon,
  InfoIcon,
  LibraryIcon,
  LoadingIcon,
  MappingIcon,
  PlayIcon,
  PlusIcon,
  PreviewIcon,
  RefreshIcon,
  SaveIcon,
  TextIcon,
  LongTextIcon,
  MarkdownIcon,
  NumberIcon,
  BooleanIcon,
  DateIcon,
  SlugIcon,
  ColorIcon,
  UrlIcon,
  TrashIcon,
  WarningIcon,
} from "../../components/icons";
import type { IconComponent } from "../../components/icons";
import type { ContentCatalog, ContentFieldKind, ContentModelRecord } from "../../content";
import type {
  CompositionCatalog,
  MappingBinding,
  MappingDefinitionDiagnostic,
  MappingEntryDiagnostic,
  MappingProvider,
  MappingTarget,
  MappingTargetDescriptor,
  MappingTransform,
} from "../../mapping";
import type { ComposerComponentProvider } from "../composer/component-provider";
import {
  compatibleTransforms,
  createMappingEditorController,
  type MappingContentEntryCatalog,
  type MappingEditorController,
  type MappingEditorState,
  type MappingPane,
  type MappingUsage,
} from "./controller";
import { parseMappingDeepLink, type MappingDeepLinkState, type MappingRouteLocation } from "./deep-link";
import { MappingPreviewHost } from "./preview-host";

export interface MappingRouteContentProps {
  provider: MappingProvider;
  contentCatalog: ContentCatalog;
  compositionCatalog: CompositionCatalog;
  contentEntries: MappingContentEntryCatalog;
  componentProvider: ComposerComponentProvider;
  usages?: readonly MappingUsage[];
  controller?: MappingEditorController;
  /** Optional route seam for direct-refresh and deep-link tests. */
  location?: MappingRouteLocation;
}

const panes: readonly MappingPane[] = ["source", "bindings", "preview"];
const paneLabels = { source: "Source", bindings: "Bindings", preview: "Preview" } as const;
const targetKey = (target: MappingTarget): string => `${target.nodeId}\u0000${target.prop}`;
const parseTarget = (value: string): MappingTarget => {
  const [nodeId, prop] = value.split("\u0000");
  return { nodeId: nodeId!, prop: prop! };
};

export function MappingApp(props: MappingRouteContentProps): JSX.Element {
  const controller = useMemo(
    () => props.controller ?? createMappingEditorController(
      props.provider,
      { content: props.contentCatalog, compositions: props.compositionCatalog },
      props.contentEntries,
      props.componentProvider.catalog,
    ),
    [props.controller, props.provider, props.contentCatalog, props.compositionCatalog, props.contentEntries, props.componentProvider.catalog],
  );
  const [state, setState] = useState<MappingEditorState>(controller.state);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const initializationStarted = useRef(false);
  const routePathname = props.location?.pathname ?? (typeof window === "undefined" ? "" : window.location.pathname);
  const routeSearch = props.location?.search ?? (typeof window === "undefined" ? "" : window.location.search);
  const parsedDeepLink = useMemo(() => parseMappingDeepLink({ pathname: routePathname, search: routeSearch }), [routePathname, routeSearch]);

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => {
    if (initializationStarted.current || controller.state.phase !== "idle") return;
    initializationStarted.current = true;
    const request = parsedDeepLink.status === "requested" ? parsedDeepLink.request : undefined;
    void Promise.resolve().then(() => controller.initialize(request)).then(() => {
      if (parsedDeepLink.status === "invalid") controller.setDeepLinkOutcome(parsedDeepLink);
    }).catch((reason: unknown) => {
      if (parsedDeepLink.status === "requested") {
        const message = reason instanceof Error ? reason.message : "Mapping initialization failed.";
        controller.setDeepLinkOutcome({ status: "provider-failure", request: parsedDeepLink.request, message });
      }
    });
  }, [controller, parsedDeepLink]);

  const run = (action: () => void | Promise<void>) => {
    const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : "Mapping action failed.");
    setError(null);
    try { void Promise.resolve(action()).catch(fail); } catch (reason) { fail(reason); }
  };
  const openDialog = (setter: (value: boolean) => void, opener: HTMLElement) => { dialogOpener.current = opener; setter(true); };
  const closeDialog = (setter: (value: boolean) => void) => { setter(false); queueMicrotask(() => dialogOpener.current?.focus()); };
  const onPreviewCurrent = useCallback(() => controller.setPreviewCurrent(), [controller]);
  const onPreviewError = useCallback((message: string) => controller.setPreviewError(message), [controller]);
  const usages = useMemo(() => new Map((props.usages ?? []).map((usage) => [usage.mappingId, usage.sitemapNames])), [props.usages]);
  const linkedOutcome = state.deepLink ?? { status: "none" as const };
  const clearLinkedRoute = () => {
    controller.setDeepLinkOutcome({ status: "none" });
    if (typeof window !== "undefined" && window.location.pathname === "/mapping") window.history.replaceState({}, "", "/mapping");
  };

  return <main class="sg-mapping-app" aria-busy={state.phase === "loading"}>
    <header class="sg-mapping-app__header">
      <div class="sg-mapping-title-block"><p class="sg-mapping-eyebrow">Mapping workspace</p><h1>{state.mapping ? state.mapping.document.name : "Mapping library"}</h1></div>
      <div class="sg-mapping-header-actions">
        <span class="sg-mapping-save" aria-live="polite" aria-atomic="true"><StatusIcon status={state.saveStatus === "error" ? "error" : state.saveStatus === "saving" ? "loading" : state.saveStatus === "saved" ? "ready" : "info"} />{state.message}</span>
        {state.mapping ? <><button type="button" onClick={() => run(async () => { await controller.close(); clearLinkedRoute(); })}><LibraryIcon size="sm" /><span>Library</span></button><button type="button" class="sg-mapping-button--primary" disabled={state.saveStatus === "saved" || state.saveStatus === "saving"} onClick={() => run(() => controller.flush())}><SaveIcon size="sm" /><span>Save</span></button></> : <button type="button" class="sg-mapping-button--primary" disabled={!state.contentModels.length || !state.compositions.length} onClick={(event) => openDialog(setNewOpen, event.currentTarget)}><PlusIcon size="sm" /><span>New Mapping</span></button>}
      </div>
    </header>
    {(error || state.saveStatus === "error") && <div class="sg-mapping-notice sg-mapping-notice--error" role="alert"><ErrorIcon size="sm" /><span>{error ?? state.message}</span>{state.saveStatus === "error" && <button type="button" onClick={() => run(() => controller.retrySave())}><RefreshIcon size="sm" /><span>Retry save</span></button>}</div>}
    {state.catalogFailures.length > 0 && <div class="sg-mapping-notice" role="status"><WarningIcon size="sm" /><strong>Some providers are unavailable.</strong>{state.catalogFailures.map((failure) => <span key={failure}>{failure}</span>)}</div>}
    {state.phase === "loading" && <div class="sg-mapping-state" role="status"><LoadingIcon size="sm" /><span>Loading Mapping library…</span></div>}
    {linkedOutcome.status !== "none" && linkedOutcome.status !== "ready" && <MappingDeepLinkStateView state={linkedOutcome} clear={clearLinkedRoute} />}
    {state.phase === "error" && linkedOutcome.status === "none" && <State title="Mapping library unavailable" message={state.message}><button type="button" class="sg-mapping-button--primary" onClick={() => run(() => controller.retryInitialization())}><RefreshIcon size="sm" /><span>Retry</span></button></State>}
    {state.phase === "recovery" && <State title="Stored Mappings need recovery" message={state.recoveryMessage ?? state.message}><p>Quarantined source data is preserved until you explicitly start fresh.</p><div class="sg-mapping-actions"><button type="button" onClick={() => run(() => controller.retryInitialization())}><RefreshIcon size="sm" /><span>Retry</span></button><button type="button" class="sg-mapping-button--danger" onClick={(event) => { dialogOpener.current = event.currentTarget; setDeleteId("__fresh__"); }}><TrashIcon size="sm" /><span>Start fresh…</span></button></div></State>}
    {state.phase === "ready" && !state.mapping && linkedOutcome.status === "none" && <MappingLibrary state={state} usages={usages} open={(id) => run(() => controller.open(id))} remove={(id, opener) => { dialogOpener.current = opener; setDeleteId(id); }} create={(opener) => openDialog(setNewOpen, opener)} />}
    {state.phase === "ready" && state.mapping && <>
      <div class="sg-mapping-tabs" role="tablist" aria-label="Mapping workspace">{panes.map((pane, index) => <button id={`sg-mapping-tab-${pane}`} key={pane} type="button" role="tab" aria-selected={state.activePane === pane} aria-controls={`sg-mapping-panel-${pane}`} tabIndex={state.activePane === pane ? 0 : -1} onClick={() => controller.setActivePane(pane)} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const next = (index + (event.key === "ArrowRight" ? 1 : -1) + panes.length) % panes.length; controller.setActivePane(panes[next]!); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus(); }}><PaneIcon pane={pane} /><span>{paneLabels[pane]}</span></button>)}</div>
      <div class="sg-mapping-workspace">
        <SourcePane state={state} controller={controller} run={run} />
        <BindingsPane state={state} controller={controller} run={run} test={(opener) => { dialogOpener.current = opener; run(async () => { await controller.testDefinition(); setTestOpen(true); }); }} />
        <MappingPreviewPane state={state} componentProvider={props.componentProvider} onCurrent={onPreviewCurrent} onError={onPreviewError} />
      </div>
    </>}
    {newOpen && <NewMappingDialog state={state} close={() => closeDialog(setNewOpen)} create={(name, contentRef, compositionRef) => run(async () => { await controller.create(name, contentRef, compositionRef); closeDialog(setNewOpen); })} />}
    {deleteId && <ConfirmDialog title={deleteId === "__fresh__" ? "Start fresh?" : "Delete Mapping?"} close={() => { setDeleteId(null); queueMicrotask(() => dialogOpener.current?.focus()); }} confirm={() => run(async () => { if (deleteId === "__fresh__") await controller.startFresh(); else await controller.delete(deleteId); setDeleteId(null); })}><p>{deleteId === "__fresh__" ? "All quarantined Mapping records will be permanently discarded." : <><strong>{state.mappings.find((mapping) => mapping.id === deleteId)?.name}</strong> will be permanently removed.</>}</p></ConfirmDialog>}
    {testOpen && <TestDialog state={state} close={() => closeDialog(setTestOpen)} />}
  </main>;
}

function MappingLibrary({ state, usages, open, remove, create }: { state: MappingEditorState; usages: ReadonlyMap<string, readonly string[]>; open(id: string): void; remove(id: string, opener: HTMLElement): void; create(opener: HTMLElement): void }) {
  if (!state.mappings.length) return <div class="sg-mapping-empty"><InfoIcon size="md" /><h2>No Mappings</h2><p>Create a Mapping to connect Content fields to a Composition.</p><button type="button" class="sg-mapping-button--primary" disabled={!state.contentModels.length || !state.compositions.length} onClick={(event) => create(event.currentTarget)}><PlusIcon size="sm" /><span>Create Mapping</span></button></div>;
  return <section aria-labelledby="mapping-library-heading"><div class="sg-mapping-section-heading"><div><div class="sg-mapping-heading-label"><LibraryIcon size="sm" /><span>Library</span></div><h2 id="mapping-library-heading">Saved Mappings</h2><p>{state.mappings.length} total · provider-qualified records</p></div></div><ul class="sg-mapping-library">{state.mappings.map((summary) => { const detail = state.libraryDetails[summary.id]; const model = detail?.definition.contentModel; const composition = detail?.definition.composition; const usedBy = usages.get(summary.id) ?? []; const status = detail?.definition.status === "ready" ? "Ready" : detail ? "Broken" : "Checking…"; return <li key={summary.id} class="sg-mapping-card"><button type="button" class="sg-mapping-card__open" onClick={() => open(summary.id)}><span class="sg-mapping-card__title"><EntryIcon size="sm" /><strong>{summary.name}</strong></span><span><ContentIcon size="xs" />{model ? `${model.document.name} · ${model.document.kind}` : "Missing Content source"}</span><span><ComposerIcon size="xs" />{composition?.document.name ?? "Missing Composition target"}</span><span class="sg-mapping-card__status"><StatusIcon status={status === "Ready" ? "ready" : status === "Broken" ? "error" : "loading"} />{summary.bindingCount} binding{summary.bindingCount === 1 ? "" : "s"} · {status}</span>{usedBy.length > 0 && <span>Used by {usedBy.join(", ")}</span>}</button><button type="button" class="sg-mapping-button--danger sg-mapping-card__delete" aria-label={`Delete ${summary.name}`} onClick={(event) => remove(summary.id, event.currentTarget)}><TrashIcon size="sm" /><span>Delete</span></button></li>; })}</ul></section>;
}

function SourcePane({ state, controller, run }: { state: MappingEditorState; controller: MappingEditorController; run(action: () => void | Promise<void>): void }) {
  const mapping = state.mapping!;
  const modelValue = `${mapping.document.contentModel.providerId}\u0000${mapping.document.contentModel.recordId}`;
  const compositionValue = `${mapping.document.composition.providerId}\u0000${mapping.document.composition.recordId}`;
  return <section id="sg-mapping-panel-source" role="tabpanel" aria-labelledby="sg-mapping-tab-source" class="sg-mapping-pane sg-mapping-pane--source" data-active={state.activePane === "source"}>
    <PaneHeading title="Source" detail="Content model and sample Entry" icon={ContentIcon} />
    {state.entryFailure && <div class="sg-mapping-notice sg-mapping-notice--error" role="alert"><ErrorIcon size="sm" /><span>Entry provider unavailable: {state.entryFailure}</span></div>}
    <div class="sg-mapping-form">
      <label>Mapping name<input value={mapping.document.name} onInput={(event) => controller.rename(event.currentTarget.value)} /></label>
      <label>Content model<select value={modelValue} onChange={(event) => { const [providerId, recordId] = event.currentTarget.value.split("\u0000"); run(() => controller.selectContentModel({ providerId: providerId!, recordId: recordId! })); }}>{!state.contentModels.some((entry) => `${entry.ref.providerId}\u0000${entry.ref.recordId}` === modelValue) && <option value={modelValue}>Missing model ({mapping.document.contentModel.recordId})</option>}{state.contentModels.map((entry) => <option key={`${entry.ref.providerId}:${entry.ref.recordId}`} value={`${entry.ref.providerId}\u0000${entry.ref.recordId}`}>{entry.summary.name} · {entry.summary.kind} · {entry.providerLabel}</option>)}</select></label>
      <label>Composition<select value={compositionValue} onChange={(event) => { const [providerId, recordId] = event.currentTarget.value.split("\u0000"); run(() => controller.selectComposition({ providerId: providerId as never, recordId: recordId! })); }}>{!state.compositions.some((entry) => `${entry.ref.providerId}\u0000${entry.ref.recordId}` === compositionValue) && <option value={compositionValue}>Missing Composition ({mapping.document.composition.recordId})</option>}{state.compositions.map((entry) => <option key={`${entry.ref.providerId}:${entry.ref.recordId}`} value={`${entry.ref.providerId}\u0000${entry.ref.recordId}`}>{entry.summary.name} · {entry.providerLabel}</option>)}</select></label>
      <label>Sample Entry<select value={state.entry?.id ?? ""} disabled={!state.entries.length} onChange={(event) => run(() => controller.selectEntry(event.currentTarget.value))}><option value="">{state.entries.length ? "Choose an Entry" : "No Entries available"}</option>{state.entries.map((entry) => <option key={entry.id} value={entry.id}>{entryLabel(entry, state.definition?.contentModel ?? null)} · {entry.id}</option>)}</select></label>
    </div>
    {state.definition?.contentModel && <div class="sg-mapping-source-fields"><div class="sg-mapping-subheading"><ContentIcon size="sm" /><h3>Available fields</h3></div>{state.definition.contentModel.document.fields.length ? <ul>{state.definition.contentModel.document.fields.map((field) => { const FieldIcon = fieldIcon(field.kind); return <li key={field.id}><span class="sg-mapping-field-name"><FieldIcon size="sm" /><strong>{field.label}</strong></span><span>{field.key} · {field.kind}{field.required ? " · required" : ""}</span></li>; })}</ul> : <p>No fields in this model.</p>}</div>}
  </section>;
}

function BindingsPane({ state, controller, run, test }: { state: MappingEditorState; controller: MappingEditorController; run(action: () => void | Promise<void>): void; test(opener: HTMLElement): void }) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const definition = state.definition;
  const fields = definition?.contentModel?.document.fields ?? [];
  const targets = definition?.targets ?? [];
  const readiness = definition?.status === "ready" ? "Ready" : `${definition?.diagnostics.length ?? 0} blocking`;
  return <section id="sg-mapping-panel-bindings" role="tabpanel" aria-labelledby="sg-mapping-tab-bindings" class="sg-mapping-pane sg-mapping-pane--bindings" data-active={state.activePane === "bindings"}>
    <div class="sg-mapping-pane__heading"><PaneHeading title="Bindings" detail={`${state.mapping!.document.bindings.length} rows · ${readiness}`} icon={MappingIcon} /><button type="button" onClick={(event) => test(event.currentTarget)}><PlayIcon size="sm" /><span>Test Mapping</span></button></div>
    <div class="sg-mapping-add-binding"><div class="sg-mapping-add-binding__heading"><PlusIcon size="sm" /><div><strong>Add a binding</strong><span>Choose a typed source and target</span></div></div><label>Source field<select value={source} onChange={(event) => setSource(event.currentTarget.value)}><option value="">Choose source</option>{fields.map((field) => <option key={field.id} value={field.id}>{field.label} · {field.kind}</option>)}</select></label><label>Target field<select value={target} onChange={(event) => setTarget(event.currentTarget.value)}><option value="">Choose target</option>{targets.map((item) => <option key={targetKey(item.target)} value={targetKey(item.target)}>{item.nodeLabel} / {item.fieldLabel} · {item.kind}</option>)}</select></label><button type="button" disabled={!source || !target} onClick={() => run(async () => { await controller.addBinding(source, parseTarget(target)); setSource(""); setTarget(""); })}><PlusIcon size="sm" /><span>Add binding</span></button></div>
    {!state.mapping!.document.bindings.length ? <div class="sg-mapping-empty"><MappingIcon size="md" /><h3>No bindings</h3><p>Choose a source and compatible target. Static Composition values remain unchanged until a binding applies.</p></div> : <ol class="sg-mapping-bindings">{state.mapping!.document.bindings.map((binding, index) => <BindingRow key={binding.id} binding={binding} index={index} count={state.mapping!.document.bindings.length} state={state} controller={controller} run={run} />)}</ol>}
  </section>;
}

function BindingRow({ binding, index, count, state, controller, run }: { binding: MappingBinding; index: number; count: number; state: MappingEditorState; controller: MappingEditorController; run(action: () => void | Promise<void>): void }) {
  const fields = state.definition?.contentModel?.document.fields ?? [];
  const targets = state.definition?.targets ?? [];
  const source = fields.find((field) => field.id === binding.sourceFieldId);
  const target = targets.find((item) => targetKey(item.target) === targetKey(binding.target));
  const transforms = source && target ? compatibleTransforms(source.kind, target) : [binding.transform.kind];
  const diagnostics = state.definition?.diagnostics.filter((item) => item.bindingId === binding.id) ?? [];
  const chooseSource = (sourceFieldId: string) => { const nextSource = fields.find((field) => field.id === sourceFieldId); const kinds = nextSource && target ? compatibleTransforms(nextSource.kind, target) : []; const transform = kinds.includes(binding.transform.kind) ? binding.transform : transformValue(kinds[0] ?? "identity", binding.transform); run(() => controller.updateBinding(binding.id, { sourceFieldId, transform })); };
  const chooseTarget = (value: string) => { const parsed = parseTarget(value); const nextTarget = targets.find((item) => targetKey(item.target) === value); const kinds = source && nextTarget ? compatibleTransforms(source.kind, nextTarget) : []; const transform = kinds.includes(binding.transform.kind) ? binding.transform : transformValue(kinds[0] ?? "identity", binding.transform); run(() => controller.updateBinding(binding.id, { target: parsed, transform })); };
  const SourceIcon = source ? fieldIcon(source.kind) : ErrorIcon;
  const TargetIcon = target ? targetKindIcon(target.kind) : ErrorIcon;
  return <li class="sg-mapping-binding" data-broken={diagnostics.length > 0}>
    <div class="sg-mapping-binding__order"><span class="sg-mapping-binding__number">Binding {index + 1}</span><button type="button" aria-label={`Move binding ${index + 1} up`} disabled={index === 0} onClick={() => run(() => controller.moveBinding(binding.id, -1))}><ArrowUpIcon size="sm" /></button><button type="button" aria-label={`Move binding ${index + 1} down`} disabled={index === count - 1} onClick={() => run(() => controller.moveBinding(binding.id, 1))}><ArrowDownIcon size="sm" /></button></div>
    <div class="sg-mapping-binding__flow" aria-label={`Binding ${index + 1}: source to transform to target`}>
      <BindingRegion className="sg-mapping-binding__region--source" title="Source" detail={source ? `${source.kind} field` : "Missing field"} icon={SourceIcon}><label>Source<select value={binding.sourceFieldId} onChange={(event) => chooseSource(event.currentTarget.value)}>{!source && <option value={binding.sourceFieldId}>Missing field ({binding.sourceFieldId})</option>}{fields.map((field) => <option key={field.id} value={field.id}>{field.label} · {field.kind}</option>)}</select></label></BindingRegion>
      <ArrowRightIcon class="sg-mapping-binding__connector" size="md" />
      <BindingRegion className="sg-mapping-binding__region--transform" title="Transform" detail={transformDescription(binding.transform)} icon={MappingIcon}><label>Transform<select value={binding.transform.kind} onChange={(event) => run(() => controller.updateBinding(binding.id, { transform: transformValue(event.currentTarget.value as MappingTransform["kind"], binding.transform) }))}>{transforms.map((kind) => <option key={kind} value={kind}>{transformLabel(kind)}</option>)}</select></label>{binding.transform.kind === "prefix" && <label>Prefix<input value={binding.transform.prefix} maxLength={80} onInput={(event) => run(() => controller.updateBinding(binding.id, { transform: { kind: "prefix", prefix: event.currentTarget.value } }))} /></label>}</BindingRegion>
      <ArrowRightIcon class="sg-mapping-binding__connector" size="md" />
      <BindingRegion className="sg-mapping-binding__region--target" title="Target" detail={target ? `${target.kind} property` : "Missing target"} icon={TargetIcon}><label>Target<select value={targetKey(binding.target)} onChange={(event) => chooseTarget(event.currentTarget.value)}>{!target && <option value={targetKey(binding.target)}>Missing target ({binding.target.nodeId} / {binding.target.prop})</option>}{targets.map((item) => <option key={targetKey(item.target)} value={targetKey(item.target)}>{item.nodeLabel} / {item.fieldLabel} · {item.kind}</option>)}</select></label></BindingRegion>
    </div>
    <button type="button" class="sg-mapping-button--danger sg-mapping-binding__remove" onClick={() => run(() => controller.removeBinding(binding.id))}><TrashIcon size="sm" /><span>Remove</span></button>
    {diagnostics.map((diagnostic) => <p key={`${diagnostic.code}:${diagnostic.message}`} class="sg-mapping-inline-error" role="status"><ErrorIcon size="sm" /><span>{diagnostic.message}</span></p>)}
  </li>;
}

function BindingRegion({ className, title, detail, icon: Icon, children }: { className: string; title: string; detail: string; icon: IconComponent; children: ComponentChildren }) {
  return <div class={`sg-mapping-binding__region ${className}`}><div class="sg-mapping-binding__region-heading"><Icon size="sm" /><div><strong>{title}</strong><span>{detail}</span></div></div>{children}</div>;
}

function MappingPreviewPane({ state, componentProvider, onCurrent, onError }: { state: MappingEditorState; componentProvider: ComposerComponentProvider; onCurrent(): void; onError(message: string): void }) {
  const mapping = state.mapping!;
  const compositionEntry = state.compositions.find((entry) => entry.ref.providerId === mapping.document.composition.providerId && entry.ref.recordId === mapping.document.composition.recordId);
  const compositionName = state.definition?.composition?.document.name ?? compositionEntry?.summary.name ?? mapping.document.composition.recordId;
  const compositionProvider = compositionEntry?.providerLabel ?? mapping.document.composition.providerId;
  const entryName = state.entry ? entryLabel(state.entry, state.definition?.contentModel ?? null) : "No sample Entry selected";
  const diagnostics: readonly (MappingDefinitionDiagnostic | MappingEntryDiagnostic)[] = [...(state.definition?.diagnostics ?? []), ...(state.evaluation?.entryDiagnostics ?? [])];
  const previewFailure = state.previewStatus === "error" && state.message ? state.message : null;
  return <section id="sg-mapping-panel-preview" role="tabpanel" aria-labelledby="sg-mapping-tab-preview" class="sg-mapping-pane sg-mapping-pane--preview" data-active={state.activePane === "preview"} aria-busy={state.previewStatus === "loading"}>
    <PaneHeading title="Preview" detail="Evaluated Composition" icon={PreviewIcon} />
    <div class="sg-mapping-preview-context" aria-label="Preview context"><div><span>Entry</span><strong>{entryName}</strong><small>{state.entry?.id ?? "Select an Entry in Source"}</small></div><div><span>Composition</span><strong>{compositionName}</strong><small>{compositionProvider} · {mapping.document.composition.recordId}</small></div></div>
    <PreviewStatus state={state} />
    <MappingPreviewHost componentProvider={componentProvider} document={state.previewDocument} loading={state.previewStatus === "loading"} onCurrent={onCurrent} onError={onError} />
    <section class="sg-mapping-preview-diagnostics" aria-labelledby="sg-mapping-preview-diagnostics-title"><div class="sg-mapping-subheading"><InfoIcon size="sm" /><h3 id="sg-mapping-preview-diagnostics-title">Diagnostics</h3><span>{diagnostics.length + (state.entryFailure ? 1 : 0) + (previewFailure ? 1 : 0)}</span></div>{!diagnostics.length && !state.entryFailure && !previewFailure ? <p class="sg-mapping-diagnostics-empty">No blocking or nonblocking diagnostics.</p> : <ul class="sg-mapping-diagnostics">{state.entryFailure && <li><StatusIcon status="error" /><div><strong>Provider failure</strong><span>{state.entryFailure}</span></div></li>}{previewFailure && <li><StatusIcon status="error" /><div><strong>Preview host failure</strong><span>{previewFailure}</span></div></li>}{diagnostics.map((item, index) => <li key={`${item.scope}:${item.code}:${index}`}><StatusIcon status={item.severity === "blocking" ? "error" : "warning"} /><div><strong>{item.scope === "definition" ? "Definition" : "Entry"} · {item.severity}</strong><span>{item.message}</span></div></li>)}</ul>}</section>
  </section>;
}

function PreviewStatus({ state }: { state: MappingEditorState }) {
  const status = state.previewStatus === "current" ? "current" : state.previewStatus === "loading" ? "loading" : state.previewStatus === "error" ? "error" : "empty";
  const label = status === "current" ? "Current" : status === "loading" ? "Updating" : status === "error" ? "Preview unavailable" : "Waiting for a valid Composition and Entry";
  return <div class={`sg-mapping-preview-status sg-mapping-preview-status--${status}`} role="status"><StatusIcon status={status === "current" ? "ready" : status === "loading" ? "loading" : status === "error" ? "error" : "info"} /><span><strong>Preview status</strong> {label}</span>{state.evaluation && <span>{state.evaluation.appliedBindingCount} applied · {state.evaluation.unchangedStaticCount} static</span>}</div>;
}

function MappingDeepLinkStateView({ state, clear }: { state: Exclude<MappingDeepLinkState, { status: "none" } | { status: "ready" }>; clear(): void }) {
  if (state.status === "loading") return <State title="Opening linked Mapping" message={`Provider ${state.request.providerId} · record ${state.request.mappingId}`}><LoadingIcon size="sm" /><span>Loading the exact provider-qualified record…</span></State>;
  const title = state.status === "invalid" ? "Invalid Mapping link" : state.status === "missing" ? "Mapping not found" : "Mapping provider unavailable";
  const Icon = state.status === "invalid" ? WarningIcon : ErrorIcon;
  return <section class="sg-mapping-state sg-mapping-state--link" role="alert"><Icon size="md" /><h2>{title}</h2><p>{state.message}</p><button type="button" class="sg-mapping-button--secondary" onClick={clear}><LibraryIcon size="sm" /><span>Return to Mapping library</span></button></section>;
}

function NewMappingDialog({ state, close, create }: { state: MappingEditorState; close(): void; create(name: string, content: MappingEditorState["contentModels"][number]["ref"], composition: MappingEditorState["compositions"][number]["ref"]): void }) {
  const [name, setName] = useState("Untitled Mapping");
  const [content, setContent] = useState(0);
  const [composition, setComposition] = useState(0);
  return <Modal labelledBy="mapping-new-title" close={close}><div class="sg-mapping-dialog-heading"><PlusIcon size="md" /><h2 id="mapping-new-title">Create Mapping</h2></div><div class="sg-mapping-form"><label>Name<input autoFocus value={name} onInput={(event) => setName(event.currentTarget.value)} /></label><label>Content model<select value={content} onChange={(event) => setContent(Number(event.currentTarget.value))}>{state.contentModels.map((entry, index) => <option key={`${entry.ref.providerId}:${entry.ref.recordId}`} value={index}>{entry.summary.name} · {entry.summary.kind} · {entry.providerLabel}</option>)}</select></label><label>Composition<select value={composition} onChange={(event) => setComposition(Number(event.currentTarget.value))}>{state.compositions.map((entry, index) => <option key={`${entry.ref.providerId}:${entry.ref.recordId}`} value={index}>{entry.summary.name} · {entry.providerLabel}</option>)}</select></label></div><div class="sg-mapping-actions"><button type="button" onClick={close}><span>Cancel</span></button><button type="button" class="sg-mapping-button--primary" disabled={!name.trim() || !state.contentModels[content] || !state.compositions[composition]} onClick={() => create(name, state.contentModels[content]!.ref, state.compositions[composition]!.ref)}><PlusIcon size="sm" /><span>Create</span></button></div></Modal>;
}

function ConfirmDialog({ title, close, confirm, children }: { title: string; close(): void; confirm(): void; children: ComponentChildren }) { return <Modal labelledBy="mapping-confirm-title" close={close} role="alertdialog"><div class="sg-mapping-dialog-heading"><WarningIcon size="md" /><h2 id="mapping-confirm-title">{title}</h2></div><div>{children}</div><div class="sg-mapping-actions"><button type="button" autoFocus onClick={close}><span>Cancel</span></button><button type="button" class="sg-mapping-button--danger" onClick={confirm}><TrashIcon size="sm" /><span>{title.startsWith("Start") ? "Start fresh" : "Delete"}</span></button></div></Modal>; }
function TestDialog({ state, close }: { state: MappingEditorState; close(): void }) { const diagnostics: readonly (MappingDefinitionDiagnostic | MappingEntryDiagnostic)[] = [...(state.definition?.diagnostics ?? []), ...(state.evaluation?.entryDiagnostics ?? [])]; return <Modal labelledBy="mapping-test-title" close={close} test><div class="sg-mapping-dialog-heading"><PlayIcon size="md" /><h2 id="mapping-test-title">Mapping test</h2></div><p><strong>{diagnostics.some((item) => item.severity === "blocking") ? "Blocked" : "Ready"}</strong> · definition readiness and sample Entry evaluation are reported separately.</p>{!diagnostics.length ? <p>No diagnostics.</p> : <ul class="sg-mapping-diagnostics">{diagnostics.map((item, index) => <li key={`${item.scope}:${item.code}:${index}`}><StatusIcon status={item.severity === "blocking" ? "error" : "warning"} /><div><strong>{item.scope === "definition" ? "Definition" : "Entry"} · {item.severity}</strong><span>{item.message}</span></div></li>)}</ul>}<div class="sg-mapping-actions"><button type="button" autoFocus onClick={close}><span>Close</span></button></div></Modal>; }
function Modal({ labelledBy, close, role = "dialog", test = false, children }: { labelledBy: string; close(): void; role?: "dialog" | "alertdialog"; test?: boolean; children: ComponentChildren }) { const ref = useRef<HTMLDialogElement | null>(null); useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []); return <dialog ref={ref} class={`sg-mapping-dialog${test ? " sg-mapping-dialog--test" : ""}`} role={role} aria-modal="true" aria-labelledby={labelledBy} onCancel={(event) => { event.preventDefault(); close(); }}>{children}</dialog>; }
function State({ title, message, children }: { title: string; message: string; children?: ComponentChildren }) { return <section class="sg-mapping-state"><InfoIcon size="md" /><h2>{title}</h2><p>{message}</p>{children}</section>; }
function PaneHeading({ title, detail, icon: Icon }: { title: string; detail: string; icon: IconComponent }) { return <div class="sg-mapping-pane__heading"><div class="sg-mapping-pane__heading-title"><Icon size="sm" /><div><h2>{title}</h2><p>{detail}</p></div></div></div>; }
function PaneIcon({ pane }: { pane: MappingPane }) { const Icon = pane === "source" ? ContentIcon : pane === "bindings" ? MappingIcon : PreviewIcon; return <Icon size="sm" />; }
function StatusIcon({ status }: { status: "ready" | "loading" | "warning" | "error" | "info" }) { const Icon = status === "ready" ? CheckCircleIcon : status === "loading" ? LoadingIcon : status === "warning" ? WarningIcon : status === "error" ? ErrorIcon : InfoIcon; return <Icon size="sm" />; }
function entryLabel(entry: MappingEditorState["entries"][number], model: ContentModelRecord | null): string { for (const field of model?.document.fields ?? []) { const value = entry.values[field.id]; if (typeof value === "string" && value.trim()) return value; } return "Untitled Entry"; }
function transformValue(kind: MappingTransform["kind"], previous: MappingTransform): MappingTransform { return kind === "prefix" ? { kind, prefix: previous.kind === "prefix" ? previous.prefix : "" } : { kind }; }
function transformLabel(kind: MappingTransform["kind"]): string { return kind === "identity" ? "Use value" : kind === "date-medium" ? "Format date (medium)" : kind === "truncate-160" ? "Truncate to 160" : "Add prefix"; }
function transformDescription(transform: MappingTransform): string { return transform.kind === "identity" ? "Pass through" : transform.kind === "date-medium" ? "Format date" : transform.kind === "truncate-160" ? "Limit length" : transform.prefix ? `Prefix: ${transform.prefix}` : "Add a prefix"; }
function fieldIcon(kind: ContentFieldKind): IconComponent {
  return kind === "text" ? TextIcon : kind === "long-text" ? LongTextIcon : kind === "markdown" ? MarkdownIcon : kind === "number" ? NumberIcon : kind === "boolean" ? BooleanIcon : kind === "date" ? DateIcon : kind === "slug" ? SlugIcon : kind === "color" ? ColorIcon : UrlIcon;
}
function targetKindIcon(kind: MappingTargetDescriptor["kind"]): IconComponent { return kind === "text" ? TextIcon : kind === "boolean" ? BooleanIcon : kind === "number" ? NumberIcon : kind === "color" ? ColorIcon : ComposerIcon; }
