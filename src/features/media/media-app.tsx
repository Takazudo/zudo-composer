import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { parseIntent, type RouteIntentParseOutcome } from "../../app/route-intents";
import { CheckCircleIcon, FolderIcon, InfoIcon, TrashIcon, UploadIcon } from "../../components/icons";
import {
  BulkBar,
  LibraryEmpty,
  LibraryPage,
  LibraryRecoveryBanner,
  LibrarySkeleton,
  LibraryUnavailableBanner,
  useLibraryConfirm,
  useLibraryQuery,
  useLibrarySelection,
  type LibraryFacet,
  type LibraryView,
} from "../../components/library-page";
import { ConfirmDialog } from "../../components/overlay";
import { Banner, Button, StatusChip } from "../../components/ui";
import type { MediaProvider, MediaSummary } from "../../media";
import {
  createMediaLibraryController,
  type MediaLibraryController,
  type MediaLibraryControllerOptions,
  type MediaLibraryState,
  type MediaReferenceScan,
} from "./controller";
import { MediaDetailPanel } from "./media-detail";
import { useMediaDimensions } from "./media-dimensions";
import {
  MediaLibrary,
  MEDIA_SORTS,
  MEDIA_TYPE_FILTER_ID,
  mediaMatchesTypeFilter,
} from "./media-library";
import { MediaUploadPanel, useMediaUpload, type MediaUploadStore } from "./media-upload";

export interface MediaRouteContentProps {
  provider?: MediaProvider;
  controller?: MediaLibraryController;
  controllerOptions?: MediaLibraryControllerOptions;
  /** The `/media?asset=` deep link; the address bar is read when omitted. */
  intent?: RouteIntentParseOutcome;
  /** Seeds the persisted grid/list choice in tests. */
  initialView?: LibraryView;
}

const VIEW_STORAGE_KEY = "zudo-composer.media.view";

const TYPE_FACET: LibraryFacet<MediaSummary> = {
  id: MEDIA_TYPE_FILTER_ID,
  label: "Type",
  options: [
    { id: "all", label: "All" },
    { id: "images", label: "Images", match: (row) => mediaMatchesTypeFilter(row, "images") },
    { id: "pdfs", label: "PDFs", match: (row) => mediaMatchesTypeFilter(row, "pdfs") },
  ],
};

const ADVISORY =
  "Not authoritative: references may also exist as opaque URL text in browser Content or filesystem compositions. A clear scan does not prove this media is unused.";

/** A memory provider has no `upload`, so the uploader needs an inert stand-in. */
const NO_UPLOAD_STORE: MediaUploadStore = {
  upload: () => Promise.reject(new Error("This build has no development media file provider.")),
};

function isMediaUploadStore(store: MediaProvider["store"]): store is MediaProvider["store"] & MediaUploadStore {
  return "upload" in store && typeof store.upload === "function";
}

function readStoredView(): LibraryView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "table" ? "table" : "cards";
  } catch {
    // A browser with site data blocked still gets a working route.
    return "cards";
  }
}

function writeStoredView(view: LibraryView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* The preference is a convenience; losing it must not break the view. */
  }
}

export function MediaApp({ provider, controller, controllerOptions, intent, initialView }: MediaRouteContentProps): JSX.Element {
  if (!provider) return <DisconnectedMedia />;
  return (
    <ConnectedMedia
      provider={provider}
      supplied={controller}
      controllerOptions={controllerOptions}
      intent={intent}
      initialView={initialView}
    />
  );
}

interface ConnectedMediaProps {
  provider: MediaProvider;
  supplied?: MediaLibraryController;
  controllerOptions?: MediaLibraryControllerOptions;
  intent?: RouteIntentParseOutcome;
  initialView?: LibraryView;
}

function ConnectedMedia({ provider, supplied, controllerOptions, intent, initialView }: ConnectedMediaProps): JSX.Element {
  const controller = useMemo(
    () => supplied ?? createMediaLibraryController(provider, controllerOptions),
    [provider, supplied, controllerOptions],
  );
  const [state, setState] = useState<MediaLibraryState>(controller.state);
  const [view, setView] = useState<LibraryView>(() => initialView ?? readStoredView());
  const [activeId, setActiveId] = useState<string | null>(null);
  const parsedIntent = useMemo(() => intent ?? parseIntent(), [intent]);
  const [linkNotice, setLinkNotice] = useState<string | null>(
    parsedIntent.status === "invalid" ? parsedIntent.message : null,
  );
  const alive = useRef(true);
  const dimensions = useMediaDimensions();
  const confirm = useLibraryConfirm();

  useEffect(() => {
    alive.current = true;
    const unsubscribe = controller.subscribe(setState);
    return () => { alive.current = false; unsubscribe(); if (!supplied) controller.dispose(); };
  }, [controller, supplied]);
  useEffect(() => { if (controller.state.phase === "idle") void controller.initialize(); }, [controller]);

  const run = (action: () => void | Promise<void>): void => {
    const fail = (reason: unknown) => { if (alive.current) controller.reportFailure(reason); };
    controller.clearNotice();
    try { void Promise.resolve(action()).catch(fail); } catch (reason) { fail(reason); }
  };

  const records = state.records;
  const query = useLibraryQuery<MediaSummary>({
    rows: records,
    searchText: (row) => `${row.fileName} ${row.id}`,
    facets: [TYPE_FACET],
    sorts: MEDIA_SORTS,
  });
  const selection = useLibrarySelection({ rows: records, visibleRows: query.rows, rowId: (row) => row.id });

  const uploadStore = isMediaUploadStore(provider.store) ? provider.store : undefined;
  const upload = useMediaUpload({ store: uploadStore ?? NO_UPLOAD_STORE, refresh: () => controller.refresh() });

  // The deep link selects once, and only when it names an asset that is here.
  const appliedIntent = useRef(false);
  useEffect(() => {
    if (appliedIntent.current || state.phase !== "ready") return;
    appliedIntent.current = true;
    if (parsedIntent.status !== "matched" || parsedIntent.intent.route !== "media") return;
    const wanted = parsedIntent.intent.assetId;
    if (records.some((record) => record.id === wanted)) setActiveId(wanted);
    else setLinkNotice(`This library has no media asset with the id ${wanted}.`);
  }, [parsedIntent, records, state.phase]);

  // A deleted asset must not leave the detail panel showing a record that is gone.
  const active = records.find((record) => record.id === activeId) ?? null;
  useEffect(() => { if (activeId !== null && active === null) setActiveId(null); }, [active, activeId]);

  const changeView = (next: LibraryView): void => { setView(next); writeStoredView(next); };

  const askDelete = (targets: readonly MediaSummary[]): void => {
    const first = targets[0];
    if (targets.length === 1 && first) run(() => controller.scanDeleteReferences(first));
    confirm.request({
      title: targets.length === 1 && first ? `Delete ${first.fileName}?` : `Delete ${targets.length} assets?`,
      message: <DeleteMessage controller={controller} target={targets.length === 1 ? first : undefined} count={targets.length} />,
      confirmLabel: "Delete permanently",
      tone: "danger",
      onConfirm: () => {
        run(() => controller.deleteMedia(targets));
        selection.clear();
      },
    });
  };

  const uploadPanel = uploadStore ? <MediaUploadPanel controller={upload} /> : null;
  const uploadAction = uploadStore ? (
    <Button variant="primary" disabled={upload.state.busy} onClick={upload.openPicker}>
      <UploadIcon size="sm" />
      Upload
    </Button>
  ) : undefined;

  const ready = state.phase === "ready" || state.phase === "recovery";

  return (
    <LibraryPage
      class="sg-media-route"
      icon={FolderIcon}
      title="Media"
      purpose="Images and PDFs delivered from /uploaded-media/. Upload authoring is available in local development only."
      actions={
        <StatusChip
          state="custom"
          label={uploadStore ? "dev · file provider connected" : "file provider read-only"}
          tone={uploadStore ? "ok" : "neutral"}
          icon={uploadStore ? CheckCircleIcon : InfoIcon}
        />
      }
      primaryAction={uploadAction}
    >
      {linkNotice ? (
        <Banner tone="warn" action={<Button size="sm" onClick={() => setLinkNotice(null)}>Dismiss</Button>}>
          {linkNotice}
        </Banner>
      ) : null}
      {state.notice ? (
        <Banner
          tone={state.notice.tone === "err" ? "err" : "info"}
          action={<Button size="sm" onClick={() => controller.clearNotice()}>Dismiss</Button>}
        >
          {state.notice.text}
        </Banner>
      ) : null}
      {state.phase === "error" ? (
        <LibraryUnavailableBanner
          title="Media library unavailable."
          description={state.errorMessage}
          onRetry={() => run(() => controller.retryInitialization())}
        />
      ) : null}
      {state.phase === "recovery" ? (
        <LibraryRecoveryBanner
          title="Stored media needs recovery."
          description={state.recoveryMessage}
          onRetry={() => run(() => controller.retryInitialization())}
          onStartFresh={() => confirm.request({
            title: "Start fresh?",
            message: "Every quarantined Media record is permanently removed. Your source records are preserved until you confirm.",
            confirmLabel: "Start fresh",
            tone: "danger",
            onConfirm: () => run(() => controller.startFresh()),
          })}
        />
      ) : null}
      {state.phase === "idle" || state.phase === "loading" ? <LibrarySkeleton columns={5} label="Loading media…" /> : null}
      {ready && records.length === 0 ? (
        <>
          {uploadPanel}
          <LibraryEmpty
            icon={FolderIcon}
            title="No media yet"
            description="Uploaded images and PDFs appear here with a public URL and a Markdown reference ready to copy."
            action={uploadStore ? (
              <Button variant="primary" disabled={upload.state.busy} onClick={upload.openPicker}>
                <UploadIcon size="sm" />
                Upload your first asset
              </Button>
            ) : undefined}
          />
        </>
      ) : null}
      {ready && records.length > 0 ? (
        <div class="sg-media-layout">
          <MediaLibrary
            records={records}
            query={query}
            selection={selection}
            dimensions={dimensions}
            view={view}
            onViewChange={changeView}
            activeId={activeId}
            onActivate={(record) => setActiveId(record.id)}
            onCopyUrl={(record) => run(() => controller.copyUrl(record))}
            onCopyMarkdown={(record) => run(() => controller.copyMarkdown(record))}
            onDelete={askDelete}
            uploadPanel={uploadPanel}
            bulkBar={selection.selectedCount > 0 ? (
              <BulkBar
                count={selection.selectedCount}
                describeCount={(count) => `${count} ${count === 1 ? "asset" : "assets"} selected`}
                actions={[{
                  id: "delete",
                  label: "Delete",
                  icon: TrashIcon,
                  tone: "danger",
                  onSelect: () => askDelete(selection.selectedRows),
                }]}
                onClear={selection.clear}
              />
            ) : null}
          />
          <MediaDetailPanel
            record={active}
            dimensions={dimensions}
            onCopyUrl={(record) => run(() => controller.copyUrl(record))}
            onCopyMarkdown={(record) => run(() => controller.copyMarkdown(record))}
            onDelete={(record) => askDelete([record])}
          />
        </div>
      ) : null}
      <ConfirmDialog
        {...confirm.dialogProps}
        onClose={() => { confirm.dialogProps.onClose(); controller.clearReferenceScan(); }}
        onConfirm={() => { confirm.dialogProps.onConfirm(); controller.clearReferenceScan(); }}
      />
    </LibraryPage>
  );
}

/**
 * The delete question, including the advisory reference scan.
 *
 * It subscribes to the controller rather than taking the scan as a prop:
 * `useLibraryConfirm` stores the message it was handed, so a node built from
 * the scan at request time would still be showing "scan waiting" after the scan
 * resolved. The advisory sentence is stated exactly here — the one place a
 * delete is actually decided — and nowhere else on the route.
 */
function DeleteMessage({ controller, target, count }: { controller: MediaLibraryController; target?: MediaSummary; count: number }): JSX.Element {
  const [scan, setScan] = useState<MediaReferenceScan>(controller.state.referenceScan);
  useEffect(() => controller.subscribe((next) => setScan(next.referenceScan)), [controller]);

  return (
    <>
      {target ? <><strong>{target.fileName}</strong>{" will be permanently removed. This cannot be undone. "}</> : null}
      {target ? null : `${count} assets will be permanently removed. This cannot be undone. `}
      <span class="sg-media-scan">
        {target ? describeScan(scan, target.id) : "No reference scan is run for a bulk delete."}
      </span>
      <span class="sg-media-advisory">{ADVISORY}</span>
    </>
  );
}

function describeScan(scan: MediaReferenceScan, mediaId: string): string {
  if (scan.status === "idle" || scan.mediaId !== mediaId) return "Advisory reference scan waiting…";
  if (scan.status === "scanning") return "Advisory reference scan in progress…";
  if (scan.status === "unavailable" || scan.status === "error") return `Advisory reference scan: ${scan.message}`;
  if (scan.references.length === 0) return "Advisory reference scan found no references in the connected sources.";
  const plural = scan.references.length === 1 ? "reference" : "references";
  return `Advisory reference scan found ${scan.references.length} possible ${plural}: ${scan.references.join(", ")}.`;
}

function DisconnectedMedia(): JSX.Element {
  return (
    <LibraryPage
      class="sg-media-route"
      icon={FolderIcon}
      title="Media"
      purpose="Images and PDFs delivered from /uploaded-media/."
      actions={<StatusChip state="custom" label="file provider not connected" tone="neutral" icon={InfoIcon} />}
    >
      <div data-media-provider-state="unavailable">
        <LibraryEmpty
          icon={FolderIcon}
          title="Media file provider not connected"
          description="Browsing and uploading media both need the development file provider, which only runs under `pnpm dev`. This standalone build still delivers committed assets from /uploaded-media/, but it cannot list or change them."
        />
      </div>
    </LibraryPage>
  );
}
