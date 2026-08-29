"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { IdFactory } from "../../../shared";
import type { CompositionCatalog } from "../../../sitemapper/catalog";
import type { SitemapProvider, SitemapRecord } from "../../../sitemapper/library";
import { createIndexedDbSitemapProvider } from "../../../sitemapper/storage/indexeddb/provider";
import { SitemapLibrary } from "../library/sitemap-library";
import { SitemapperIntegration } from "./sitemapper-integration";

export interface ProductionSitemapperAppProps {
  provider?: SitemapProvider;
  catalog: CompositionCatalog;
  idFactory?: IdFactory;
  pageIdFactory?: IdFactory;
  now?: () => string;
}

export function ProductionSitemapperApp({ provider: suppliedProvider, catalog, idFactory, pageIdFactory, now }: ProductionSitemapperAppProps): JSX.Element {
  const provider = useMemo(() => suppliedProvider ?? createIndexedDbSitemapProvider(), [suppliedProvider]);
  const [record, setRecord] = useState<SitemapRecord | null>(null);

  return (
    <div class="sg-sitemapper-root">
      {record ? (
        <SitemapperIntegration key={record.id} record={record} store={provider.store} catalog={catalog} idFactory={pageIdFactory} now={now} onBack={() => setRecord(null)} />
      ) : (
        <SitemapLibrary provider={provider} onOpen={setRecord} idFactory={idFactory} now={now} />
      )}
    </div>
  );
}

export default ProductionSitemapperApp;
