import { useRef, useState } from "preact/hooks";
import { Banner, Button, Textarea } from "../components/ui";
import type { SiteProjectValidationContext } from "../site-project/model";
import { serializeSiteProject } from "../site-project/model";
import { loadCatalogEditorialSiteProject } from "../site-project/sample/catalog-editorial";

export function CatalogEditorialExampleLoader({ context, available, busy, create, previousWorkspace }: {
  context: SiteProjectValidationContext; available: boolean; busy: boolean; create(): Promise<boolean>;
  previousWorkspace?: { id: string; open(): Promise<boolean> };
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState<string>();
  const running = useRef(false);
  const run = async () => {
    if (running.current || busy || !available) return;
    running.current = true;
    setPending(true); setError(undefined);
    try { if (await create()) setConfirming(false); else setError("The example was not opened. Check the workspace save or operation error before retrying."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Example creation failed."); }
    finally { running.current = false; setPending(false); }
  };
  return <section aria-labelledby="catalog-example-title" class="route-placeholder">
    <h2 id="catalog-example-title">Optional catalog &amp; editorial example</h2>
    <p>Explore Products, Guides, News, Support resources, ordered Series and Site settings using the normal editors. This does not change the bundled visitor site.</p>
    {previousWorkspace && <p>Preserved workspace: <code>{previousWorkspace.id}</code> <Button disabled={busy || pending} onClick={() => void previousWorkspace.open()}>Return to previous workspace</Button></p>}
    <details onToggle={(event) => setInspecting(event.currentTarget.open)}><summary>Inspect detached example JSON (no writes)</summary>{inspecting && <><p>Media fields are empty in this detached template. Creation binds four per-use links to one verified, intentionally blank local PDF.</p><Textarea aria-label="Detached example SiteProject JSON" readOnly rows={16} value={JSON.stringify(JSON.parse(serializeSiteProject(loadCatalogEditorialSiteProject(context))), null, 2)} /></>}</details>
    {!available && <p>Full example creation requires the local development Media upload capability. This environment supports detached inspection only.</p>}
    {error && <Banner tone="err" title="Example not opened">{error} A completed Media import may remain in the global library; retry reuses verified bytes. Nothing is purged.</Banner>}
    {!confirming ? <Button disabled={busy || !available} onClick={() => setConfirming(true)}>Create catalog &amp; editorial example</Button> : <div role="group" aria-label="Confirm separate example project">
      <p>Create and switch to a separate project after saving current edits? Your current workspace is preserved; this is not destructive replacement. One blank PDF is added to global Media if it is not already available. This does not apply, build or activate a release.</p>
      <Button disabled={pending || busy} onClick={() => setConfirming(false)}>Cancel</Button>
      <Button disabled={pending || busy || !available} onClick={() => void run()}>{pending ? "Creating example…" : "Confirm create separate project"}</Button>
    </div>}
  </section>;
}
