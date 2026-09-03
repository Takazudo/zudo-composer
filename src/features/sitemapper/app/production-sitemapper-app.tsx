"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { IdFactory } from "../../../shared";
import type { CompositionCatalog } from "../../../sitemapper/catalog";
import type { SitemapProvider, SitemapRecord } from "../../../sitemapper/library";
import type { MappingAssignmentCatalog } from "../../../sitemapper/routes";
import { SitemapLibrary } from "../library/sitemap-library";
import { SitemapperIntegration } from "./sitemapper-integration";

export interface ProductionSitemapperAppProps {
  /** Owned by the host integration, so one lifecycle serves every workspace. */
  provider: SitemapProvider;
  catalog: CompositionCatalog;
  mappingCatalog?: MappingAssignmentCatalog;
  idFactory?: IdFactory;
  pageIdFactory?: IdFactory;
  now?: () => string;
}

export function ProductionSitemapperApp({ provider, catalog, mappingCatalog, idFactory, pageIdFactory, now }: ProductionSitemapperAppProps): JSX.Element {
  const [record, setRecord] = useState<SitemapRecord | null>(null);

  return (
    <div class="sg-sitemapper-root">
      {record ? (
        <SitemapperIntegration key={record.id} record={record} store={provider.store} catalog={catalog} mappingCatalog={mappingCatalog} idFactory={pageIdFactory} now={now} onBack={() => setRecord(null)} />
      ) : (
        <SitemapLibrary provider={provider} onOpen={setRecord} idFactory={idFactory} now={now} />
      )}
    </div>
  );
}

export default ProductionSitemapperApp;
