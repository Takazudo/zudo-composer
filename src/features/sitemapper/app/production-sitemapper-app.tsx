"use client";

import { computed, getScope, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import type { AppServices } from "../../../app/services";
import { Keyed } from "../../../runtime";
import { Banner } from "../../../components/ui";
import type { IdFactory } from "../../../shared";
import type { CompositionCatalog } from "../../../sitemapper/catalog";
import type { SitemapProvider, SitemapRecord, SitemapRecordLoadOutcome } from "../../../sitemapper/library";
import type { MappingAssignmentCatalog } from "../../../sitemapper/routes";
import { SitemapperLoadNoticeBanner, type SitemapperLoadNotice } from "../chrome/load-notice";
import { SitemapLibrary } from "../library/sitemap-library";
import { readSitemapperIntent, SITEMAPPER_ROUTE, type SitemapperIntent } from "./sitemapper-intent";
import { SitemapperIntegration } from "./sitemapper-integration";

export interface ProductionSitemapperAppProps {
  /** Owned by the host integration, so one lifecycle serves every workspace. */
  provider: SitemapProvider;
  catalog: CompositionCatalog;
  mappingCatalog?: MappingAssignmentCatalog;
  idFactory?: IdFactory;
  pageIdFactory?: IdFactory;
  now?: () => string;
  /**
   * Route transitions. The Sitemapper is URL-addressed — `/sitemapper` is the
   * library and `/sitemapper?sitemap=&page=` is one record — so opening and
   * closing a Sitemap is a real navigation, and tests supply their own seam.
   */
  navigate?: (href: string) => void;
  /** Overrides the parsed location; the browser's own is used otherwise. */
  location?: { readonly pathname: string; readonly search: string };
  /** The shell's route services; absent when the route is mounted standalone (tests). */
  services?: AppServices;
}

type RecordState =
  | { status: "loading" }
  | { status: "loaded"; record: SitemapRecord }
  | { status: "unreadable"; notice: SitemapperLoadNotice };

function defaultNavigate(href: string): void {
  window.location.assign(href);
}

/** Everything `store.get` can answer that is not a record to edit. */
function loadNotice(
  outcome: Exclude<SitemapRecordLoadOutcome, { status: "loaded" }>,
  sitemapId: string,
): SitemapperLoadNotice {
  switch (outcome.status) {
    case "not-found":
      return { kind: "missing", sitemapId };
    case "future-schema":
      return { kind: "future-schema", sitemapId, foundSchemaVersion: outcome.foundSchemaVersion };
    default:
      return { kind: "unreadable", sitemapId, reason: outcome.issue.message };
  }
}

function SitemapperRecord({
  intent,
  provider,
  catalog,
  mappingCatalog,
  idFactory,
  recordIdFactory,
  now,
  navigate,
  services,
}: {
  intent: SitemapperIntent;
  provider: SitemapProvider;
  catalog: CompositionCatalog;
  mappingCatalog?: MappingAssignmentCatalog;
  idFactory?: IdFactory;
  recordIdFactory?: IdFactory;
  now?: () => string;
  navigate: (href: string) => void;
  services?: AppServices;
}): Child {
  const scope = getScope();
  const state = signal<RecordState>({ status: "loading" });
  const sitemapId = intent.sitemapId;

  scope.onActivate(() => {
    void provider.store.get(sitemapId)
      .then((loaded) => {
        if (scope.abortSignal.aborted) return;
        state.value = loaded.status === "loaded"
          ? { status: "loaded", record: loaded.record }
          : { status: "unreadable", notice: loadNotice(loaded, sitemapId) };
      })
      .catch((reason: unknown) => {
        if (scope.abortSignal.aborted) return;
        state.value = {
          status: "unreadable",
          notice: {
            kind: "unreadable",
            sitemapId,
            ...(reason instanceof Error ? { reason: reason.message } : {}),
          },
        };
      });
  });

  const loaded = computed(() => (state.value.status === "loaded" ? state.value.record : null));
  const notice = computed(() => (state.value.status === "unreadable" ? state.value.notice : null));
  return (
    <>
      <Show when={computed(() => state.value.status === "loading")}>{() => <p class="sg-sitemapper-loading" role="status">Loading sitemap…</p>}</Show>
      <Keyed value={notice} by={(current) => (current === null ? "" : JSON.stringify(current))}>{(current) => (
        current.value === null ? null : <SitemapperLoadNoticeBanner notice={current.value} onBack={() => navigate(SITEMAPPER_ROUTE)} />
      )}</Keyed>
      <Keyed value={loaded} by={(record) => record?.id ?? ""}>{(record) => {
        const current = record.value;
        return current === null ? null : (
          <SitemapperIntegration
            providerId={intent.providerId}
            record={current}
            store={provider.store}
            catalog={catalog}
            mappingCatalog={mappingCatalog}
            initialPageId={intent.pageId}
            navigate={navigate}
            recordIdFactory={recordIdFactory}
            idFactory={idFactory}
            now={now}
            services={services}
          />
        );
      }}</Keyed>
    </>
  );
}

export function ProductionSitemapperApp({
  provider,
  catalog,
  mappingCatalog,
  idFactory,
  pageIdFactory,
  now,
  navigate = defaultNavigate,
  location,
  services,
}: ProductionSitemapperAppProps): Child {
  // The intent is read once per load: every transition between the library and
  // a record is a real navigation, so a re-read would only ever agree with it.
  const outcome = readSitemapperIntent(location);
  if (outcome.status === "sitemap" && outcome.intent.providerId !== provider.descriptor?.id) return <Banner tone="err">The requested Sitemap provider is unavailable.</Banner>;

  return (
    <div class="sg-sitemapper-root">
      {outcome.status === "sitemap" ? (
        <SitemapperRecord
          intent={outcome.intent}
          provider={provider}
          catalog={catalog}
          mappingCatalog={mappingCatalog}
          idFactory={pageIdFactory}
          recordIdFactory={idFactory}
          now={now}
          navigate={navigate}
          services={services}
        />
      ) : (
        <SitemapLibrary
          provider={provider}
          navigate={navigate}
          notice={outcome.status === "invalid" ? <Banner tone="err" title="That link could not be opened.">{outcome.message}</Banner> : null}
          services={services}
          idFactory={idFactory}
          now={now}
        />
      )}
    </div>
  );
}

export default ProductionSitemapperApp;
