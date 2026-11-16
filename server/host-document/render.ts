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
  visit(rendered.composition.document.root, rendered.composition.local, null, null, linked ? "host-local-" : "");
  return { route: rendered, targets };
}
export function hostDocumentTargets(route: SiteCompiledRoute): HostDocumentTarget[] {
  return hostRoute(route).targets;
}

const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** Only this tool-owned bridge enters authoring output; static builds call the host renderer directly. */
export async function renderHostDocument(renderer: HostDocumentRenderer, route: SiteCompiledRoute, identity: HostDocumentIdentity, project?: import("../../src/site-project/model/types").SiteProject): Promise<HostDocumentPreview> {
  if (identity.pathname !== route.pathname) throw new Error("Document route identity differs from the compiled route.");
  const rendered = hostRoute(route);
  const targets = rendered.targets;
  const html = await renderer.renderDocument({ route: rendered.route, identity, targets, ...(project ? { project } : {}) });
  if (typeof html !== "string" || !/<\/body\s*>/i.test(html)) throw new Error("Host renderer must return a complete HTML document with a body.");
  const frameId = randomUUID();
  const bridge = `<script>(()=>{const identity=${scriptJson(identity)},frameId=${scriptJson(frameId)},targets=${scriptJson(targets.map(({ renderedNodeId, providerId, recordId, nodeId }) => ({ renderedNodeId, providerId, recordId, nodeId })))};const origin=parent.location.origin;let selecting=true;const send=(type,target)=>parent.postMessage({protocol:"zudo-host-document-v1",type,identity,frameId,...(target?{target}:{})},origin);addEventListener("message",event=>{if(event.source!==parent||event.origin!==origin)return;const data=event.data;if(data?.protocol!=="zudo-host-document-v1"||data.frameId!==frameId)return;if(data.type==="mode")selecting=data.selecting===true;if(data.type==="highlight"){document.querySelectorAll("[data-composer-selected]").forEach(el=>el.removeAttribute("data-composer-selected"));for(const el of document.querySelectorAll("[data-composer-target]"))if(el.getAttribute("data-composer-target")===data.renderedNodeId){el.setAttribute("data-composer-selected","");el.scrollIntoView({block:"nearest"});}}});document.addEventListener("click",event=>{if(!selecting)return;const el=event.target instanceof Element?event.target.closest("[data-composer-target]"):null;const target=targets.find(value=>value.renderedNodeId===el?.getAttribute("data-composer-target"));if(!target)return;event.preventDefault();event.stopImmediatePropagation();send("select",target);},true);const ready=()=>send("ready");if(document.readyState==="complete")ready();else addEventListener("load",ready,{once:true});})();</script><style>[data-composer-selected]{outline:2px solid Highlight;outline-offset:2px}</style>`;
  return { identity, frameId, targets, html: html.replace(/<\/body\s*>/i, `${bridge}</body>`) };
}
