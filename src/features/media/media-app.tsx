import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { MediaProvider, MediaSummary } from "../../media";
import { MediaConfirmDialog } from "./confirm-dialog";
import { createMediaLibraryController, type MediaLibraryController, type MediaLibraryControllerOptions, type MediaLibraryState } from "./controller";
import { MediaLibrary } from "./media-library";

export interface MediaRouteContentProps { provider?: MediaProvider; controller?: MediaLibraryController; controllerOptions?: MediaLibraryControllerOptions; }

export function MediaApp({ provider, controller: supplied, controllerOptions }: MediaRouteContentProps): JSX.Element {
  if (!provider) return <DisconnectedMedia />;
  return <ConnectedMedia provider={provider} supplied={supplied} controllerOptions={controllerOptions} />;
}

function ConnectedMedia({ provider, supplied, controllerOptions }: { provider: MediaProvider; supplied?: MediaLibraryController; controllerOptions?: MediaLibraryControllerOptions }): JSX.Element {
  const controller = useMemo(() => supplied ?? createMediaLibraryController(provider, controllerOptions), [provider, supplied, controllerOptions]);
  const [state, setState] = useState<MediaLibraryState>(controller.state);
  const [confirm, setConfirm] = useState<MediaSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = controller.subscribe(setState);
    return () => { alive.current = false; unsubscribe(); if (!supplied) controller.dispose(); };
  }, [controller, supplied]);
  useEffect(() => { if (controller.state.phase === "idle") void controller.initialize(); }, [controller]);
  const run = (action: () => void | Promise<void>) => {
    const fail = (reason: unknown) => { if (alive.current) setError(reason instanceof Error ? reason.message : "Media action failed."); };
    setError(null);
    try { void Promise.resolve(action()).catch(fail); } catch (reason) { fail(reason); }
  };
  const requestDelete = (record: MediaSummary) => { setConfirm(record); run(() => controller.scanDeleteReferences(record)); };
  const closeDelete = () => { setConfirm(null); controller.clearReferenceScan(); };

  return <main class="sg-media-app" aria-busy={state.phase === "loading"}>
    <header class="sg-media-app__header"><div><p class="sg-media-eyebrow">Asset workspace</p><h1>Media library</h1></div><div class="sg-media-status" aria-live="polite" aria-atomic="true">{state.message}</div></header>
    {error && <div class="sg-media-notice sg-media-notice--error" role="alert">{error}</div>}
    {state.phase === "loading" && <p class="sg-media-state" role="status">Loading Media library…</p>}
    {state.phase === "error" && <section class="sg-media-state" aria-labelledby="media-error"><h2 id="media-error">Media library unavailable</h2><p>{state.message}</p><button type="button" onClick={() => run(() => controller.retryInitialization())}>Retry</button></section>}
    {state.phase === "recovery" && <section class="sg-media-state" aria-labelledby="media-recovery"><h2 id="media-recovery">Stored Media needs recovery</h2><p>{state.recoveryMessage}</p><p>Your source records are quarantined and will not be overwritten.</p><div class="sg-media-actions"><button type="button" onClick={() => run(() => controller.retryInitialization())}>Retry</button><button type="button" class="sg-media-button--danger" onClick={() => run(() => controller.startFresh())}>Start fresh</button></div></section>}
    {state.phase === "ready" && <MediaLibrary state={state} controller={controller} run={run} onDelete={requestDelete} />}
    <MediaConfirmDialog open={confirm !== null} title="Delete media?" onClose={closeDelete} onConfirm={() => { if (confirm) run(() => controller.deleteMedia(confirm.id)); }}>
      <p><strong>{confirm?.fileName}</strong> will be permanently removed.</p>
      <ReferenceScan state={state} mediaId={confirm?.id} />
      <p class="sg-media-advisory"><strong>Not authoritative:</strong> references may also exist as opaque URL text in browser Content or filesystem compositions. A clear scan does not prove this media is unused.</p>
    </MediaConfirmDialog>
  </main>;
}

function ReferenceScan({ state, mediaId }: { state: MediaLibraryState; mediaId?: string }): JSX.Element {
  const scan = state.referenceScan;
  if (!mediaId || scan.status === "idle" || scan.mediaId !== mediaId) return <p>Advisory reference scan waiting…</p>;
  if (scan.status === "scanning") return <p role="status">Advisory reference scan in progress…</p>;
  if (scan.status === "unavailable" || scan.status === "error") return <p>Advisory reference scan: {scan.message}</p>;
  return scan.references.length > 0 ? <div><p>Advisory reference scan found {scan.references.length} possible reference{scan.references.length === 1 ? "" : "s"}:</p><ul>{scan.references.map((reference) => <li key={reference}>{reference}</li>)}</ul></div> : <p>Advisory reference scan found no references in the connected sources.</p>;
}

function DisconnectedMedia(): JSX.Element {
  return <main class="sg-media-app" aria-labelledby="media-title"><header class="sg-media-app__header"><div><p class="sg-media-eyebrow">Asset workspace</p><h1 id="media-title">Media library</h1></div></header><section class="sg-media-state" data-media-provider-state="unavailable" aria-labelledby="media-state-title"><div><h2 id="media-state-title">Media service not connected</h2><p>Media uploads are unavailable in this standalone build because no development media service is connected.</p></div></section></main>;
}
