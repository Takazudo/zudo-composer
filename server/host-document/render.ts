import { canonicalHostRoute } from "../../src/features/host-document/navigation";
import { previewEnvelopeValue } from "../../src/features/composer/preview/wire";
import { randomUUID } from "node:crypto";
import type { CompositionNode } from "../../src/composer/model/types";
import type { SiteCompiledRoute } from "../../src/site-project/compiler/types";
import type { HostDocumentIdentity, HostDocumentPreview, HostDocumentRenderer, HostDocumentTarget } from "./types";

function hostRoute(route: SiteCompiledRoute): { route: SiteCompiledRoute; targets: HostDocumentTarget[] } {
  const rendered = structuredClone(route);
  const targets: HostDocumentTarget[] = [];
  const visit = (nodes: readonly CompositionNode[], owner: { providerId: string; recordId: string }, parent: string | null, slot: string | null, prefix: string) => {
    const seen = new Set<string>();
    const walk = (children: readonly CompositionNode[], parentId: string | null, slotId: string | null) => {
      for (const node of children) {
        const canonicalId = node.id;
        if (seen.has(canonicalId)) throw new Error(`Ambiguous rendered target within owner: ${canonicalId}`);
        seen.add(canonicalId);
        const source = route.materializationSources?.find(value => value.renderedNodeId === canonicalId);
        node.id = `${prefix}${canonicalId}`;
        targets.push({ renderedNodeId: node.id, providerId: source?.providerId ?? owner.providerId, recordId: source?.recordId ?? owner.recordId, nodeId: source?.nodeId ?? canonicalId, componentId: node.componentId, parentRenderedNodeId: parentId, slotId, props: node.props, entries: source?.entries ?? [] });
        for (const [childSlot, descendants] of Object.entries(node.slots)) walk(descendants, node.id, childSlot);
      }
    };
    walk(nodes, parent, slot);
  };
  const linked = rendered.composition.linkedSource;
  if (linked) {
    visit(linked.document.root, linked.ref, null, null, "host-source-");
    linked.outlet.target.parentId = `host-source-${linked.outlet.target.parentId}`;
  }
  visit(rendered.composition.document.root, rendered.composition.local, linked?.outlet.target.parentId ?? null, linked?.outlet.target.slotId ?? null, linked ? "host-local-" : "");
  // Only an immediate, unmaterialized local parent is an editable placement.
  // Never climb through shared children to infer a broader operation.
  for (const target of targets) {
    if (!target.entries.length) continue;
    const parent = targets.find(value => value.renderedNodeId === target.parentRenderedNodeId);
    if (!parent || parent.entries.length || parent.providerId !== route.composition.local.providerId || parent.recordId !== route.composition.local.recordId) continue;
    const grandparent = targets.find(value => value.renderedNodeId === parent.parentRenderedNodeId);
    target.placement = { providerId: parent.providerId, recordId: parent.recordId, nodeId: parent.nodeId, parentNodeId: grandparent?.nodeId ?? null, slotId: parent.slotId };
  }
  return { route: rendered, targets };
}
export function hostDocumentTargets(route: SiteCompiledRoute): HostDocumentTarget[] {
  return hostRoute(route).targets;
}

const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** Only this tool-owned bridge enters authoring output; static builds call the host renderer directly. */
export async function renderHostDocument(renderer: HostDocumentRenderer, route: SiteCompiledRoute, identity: HostDocumentIdentity, project?: import("../../src/site-project/model/types").SiteProject, navigation?: { url: string; pathnames: readonly string[] }): Promise<HostDocumentPreview> {
  if (identity.pathname !== route.pathname) throw new Error("Document route identity differs from the compiled route.");
  if (navigation) {
    const url = new URL(navigation.url, "http://document.invalid");
    if (!navigation.url.startsWith("/") || url.origin !== "http://document.invalid" || canonicalHostRoute(url.pathname, navigation.pathnames) !== identity.pathname) throw new Error("Visitor URL must identify the captured route.");
    navigation = { ...navigation, url: url.pathname + url.search + url.hash };
  }
  const rendered = hostRoute(route);
  const targets = rendered.targets;
  const html = await renderer.renderDocument({ route: rendered.route, identity, targets, ...(project ? { project } : {}) });
  if (typeof html !== "string" || !/<\/body\s*>/i.test(html)) throw new Error("Host renderer must return a complete HTML document with a body.");
  const frameId = randomUUID();
  const bridge = `<script>(()=>{const navigation=${scriptJson(navigation ?? null)},coordination=${scriptJson(previewEnvelopeValue(identity))},identity=${scriptJson(identity)},frameId=${scriptJson(frameId)},targets=${scriptJson(targets.map(({ renderedNodeId, providerId, recordId, nodeId }) => ({ renderedNodeId, providerId, recordId, nodeId })))};const canonicalHostRoute=${canonicalHostRoute.toString()};const origin=parent.location.origin;let selecting=true;const url=()=>location.pathname+location.search+location.hash;const send=(type,payload={})=>parent.postMessage({protocol:"zudo-host-document-v1",type,identity,frameId,...(navigation?{visitorUrl:url()}:{}),...payload},origin);addEventListener("message",event=>{if(event.source!==parent||event.origin!==origin)return;const data=event.data;if(data?.type==="authoring-probe"){if(!data||Object.keys(data).length!==6||Object.keys(coordination).some(key=>data[key]!==coordination[key])||typeof data.nonce!=="string"||!/^[a-f0-9]{64}$/.test(data.nonce))return;const clean=document.readyState==="complete"&&(!navigation||url().split("#")[0]===navigation.url.split("#")[0])&&!document.querySelector('[data-zc-inline-editing], [data-zc-prose-editing], [data-zc-prose-chrome], [contenteditable]:not([contenteditable="false"])');parent.postMessage({...coordination,type:"authoring-settled",nonce:data.nonce,clean},origin);return;}if(data?.protocol!=="zudo-host-document-v1"||data.frameId!==frameId)return;if(data.type==="mode")selecting=data.selecting===true;if(data.type==="highlight"){document.querySelectorAll("[data-composer-selected]").forEach(el=>el.removeAttribute("data-composer-selected"));for(const el of document.querySelectorAll("[data-composer-target]"))if(el.getAttribute("data-composer-target")===data.renderedNodeId){el.setAttribute("data-composer-selected","");el.scrollIntoView({block:"nearest"});}}});document.addEventListener("click",event=>{if(!selecting){const link=event.target instanceof Element?event.target.closest("a[href]"):null;if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.hasAttribute("download")||link.target&&link.target!=="_self")return;const destination=new URL(link.href,location.href);if(navigation&&destination.origin===origin&&canonicalHostRoute(destination.pathname,navigation.pathnames)!==null){if(destination.pathname===location.pathname&&destination.search===location.search&&(destination.hash||link.href.includes("#")))return;event.preventDefault();event.stopImmediatePropagation();send("navigate",{url:destination.pathname+destination.search+destination.hash});}else send("leaving");return;}const el=event.target instanceof Element?event.target.closest("[data-composer-target]"):null;const target=targets.find(value=>value.renderedNodeId===el?.getAttribute("data-composer-target"));if(!target)return;event.preventDefault();event.stopImmediatePropagation();send("select",{target});},true);if(navigation){let previousUrl=url();const changed=()=>{const next=url(),previous=previousUrl;if(next===previous)return;previousUrl=next;if(canonicalHostRoute(location.pathname,navigation.pathnames)!==null)send("navigate",{url:next,visitorUrl:previous});else send("leaving",{visitorUrl:previous});};for(const name of ["pushState","replaceState"]){const original=history[name];history[name]=function(...args){const result=Reflect.apply(original,this,args);changed();return result;};}addEventListener("beforeunload",()=>send("leaving"));addEventListener("hashchange",changed);addEventListener("popstate",changed);}const ready=()=>send("ready");if(document.readyState==="complete")ready();else addEventListener("load",ready,{once:true});})();</script><style>[data-composer-selected]{outline:2px solid Highlight;outline-offset:2px}</style>`;
  let output = html.replace(/<\/body\s*>/i, `${bridge}</body>`);
  if (navigation) {
    const bootstrap = `<meta name="zudo-host-document-frame" content="${frameId}"><script>history.replaceState(null,"",${scriptJson(navigation.url)});</script>`;
    output = /<head(?:\s[^>]*)?>/i.test(output) ? output.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${bootstrap}`) : output.replace(/<html(?:\s[^>]*)?>/i, match => `${match}<head>${bootstrap}</head>`);
  }
  return { identity, frameId, targets, ...(navigation ? { navigation } : {}), html: output };
}
