"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Banner, Button } from "../../../components/ui";
import type { IdFactory } from "../../../shared";
import type { CompositionCatalog } from "../../../sitemapper/catalog";
import type { SitemapProvider, SitemapRecord } from "../../../sitemapper/library";
import type { MappingAssignmentCatalog } from "../../../sitemapper/routes";
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
}

type RecordState =
  | { status: "loading" }
  | { status: "loaded"; record: SitemapRecord }
  | { status: "unreadable"; message: string };

function defaultNavigate(href: string): void {
  window.location.assign(href);
}

function describeLoadFailure(status: string, sitemapId: string): string {
  switch (status) {
    case "not-found":
      return `Sitemap “${sitemapId}” no longer exists.`;
    case "future-schema":
      return `Sitemap “${sitemapId}” was written by a newer build and is held back rather than rewritten.`;
    default:
      return `Sitemap “${sitemapId}” could not be read and was left untouched.`;
  }
}

function OpenFailure({ message, navigate }: { message: string; navigate: (href: string) => void }): JSX.Element {
  return (
    <div class="sg-sitemapper-open-failure">
      <Banner
        tone="err"
        title="This sitemap could not be opened."
        action={<Button size="sm" onClick={() => navigate(SITEMAPPER_ROUTE)}>Back to Sitemaps</Button>}
      >
        {message}
      </Banner>
    </div>
  );
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
}: {
  intent: SitemapperIntent;
  provider: SitemapProvider;
  catalog: CompositionCatalog;
  mappingCatalog?: MappingAssignmentCatalog;
  idFactory?: IdFactory;
  recordIdFactory?: IdFactory;
  now?: () => string;
  navigate: (href: string) => void;
}): JSX.Element {
  const [state, setState] = useState<RecordState>({ status: "loading" });
  const sitemapId = intent.sitemapId;

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    void provider.store.get(sitemapId)
      .then((loaded) => {
        if (!live) return;
        setState(loaded.status === "loaded"
          ? { status: "loaded", record: loaded.record }
          : { status: "unreadable", message: describeLoadFailure(loaded.status, sitemapId) });
      })
      .catch((reason: unknown) => {
        if (!live) return;
        setState({
          status: "unreadable",
          message: reason instanceof Error ? reason.message : `Sitemap “${sitemapId}” could not be read.`,
        });
      });
    return () => { live = false; };
  }, [provider, sitemapId]);

  if (state.status === "loading") return <p class="sg-sitemapper-loading" role="status">Loading sitemap…</p>;
  if (state.status === "unreadable") return <OpenFailure message={state.message} navigate={navigate} />;
  return (
    <SitemapperIntegration
      key={state.record.id}
      record={state.record}
      store={provider.store}
      catalog={catalog}
      mappingCatalog={mappingCatalog}
      initialPageId={intent.pageId}
      navigate={navigate}
      recordIdFactory={recordIdFactory}
      idFactory={idFactory}
      now={now}
    />
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
}: ProductionSitemapperAppProps): JSX.Element {
  // The intent is read once per load: every transition between the library and
  // a record is a real navigation, so a re-read would only ever agree with it.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const outcome = useMemo(() => readSitemapperIntent(location), [location]);

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
          navigate={(href) => navigateRef.current(href)}
        />
      ) : (
        <SitemapLibrary
          provider={provider}
          navigate={(href) => navigateRef.current(href)}
          notice={outcome.status === "invalid" ? <Banner tone="err" title="That link could not be opened.">{outcome.message}</Banner> : null}
          idFactory={idFactory}
          now={now}
        />
      )}
    </div>
  );
}

export default ProductionSitemapperApp;
