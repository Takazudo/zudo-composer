import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { createContentEntryRecord } from "../../../content";
import { SavedHostContentPreview } from "../saved-host-preview";
const mocks=vi.hoisted(()=>({read:vi.fn(),matches:vi.fn(()=>true),integration:{workspace:{id:"proof"},subscribeChanges:vi.fn(()=>()=>{})}}));
vi.mock("../../native-editing/session",()=>({nativeContentRead:mocks.read}));
vi.mock("../../../app/workspace-context",()=>({useWorkspace:()=>({integration:mocks.integration})}));
vi.mock("../../host-document/protocol",async original=>({...await original<typeof import("../../host-document/protocol")>(),matchesHostDocumentFrame:mocks.matches}));
afterEach(()=>{cleanup();vi.clearAllMocks();mocks.matches.mockReturnValue(true);});
const entry=createContentEntryRecord("course",{price:"100"},{id:"consultation",timestamp:"2026-08-30T00:00:00.000Z"});
const ref={providerId:"content-filesystem",modelId:entry.modelId,recordId:entry.id};
const context={mode:"saved-page",workspaceId:"proof",revision:"a".repeat(64),entry:ref,record:entry,pack:{packId:"proof",packVersion:"1"},renderer:{id:"host",version:"1",digest:"b".repeat(64)},uses:[{sitemapProviderId:"sitemap-filesystem",sitemapId:"main",pageId:"home",pathname:"/",title:"Home",targets:[]}],unsupported:"Unsupported"};
const identity={workspaceId:"proof",revision:context.revision,pathname:"/",packId:"proof",packVersion:"1",rendererId:"host",rendererVersion:"1",rendererDigest:context.renderer.digest};
const document={identity,content:context,frameId:"frame",html:"",documentUrl:"about:blank",navigation:{url:"/",pathnames:["/"]},targets:[]};
async function opened(){mocks.read.mockImplementation(async op=>op==="content-preview-context"?context:document);const view=render(<SavedHostContentPreview providerId={ref.providerId} entry={entry} saveStatus="saved"/>);await view.findByRole("combobox");return view;}
it("does not choose a route or flush/save; explicit selection carries complete owner and captured revision",async()=>{
 const view=await opened();expect(mocks.read.mock.calls).toEqual([["content-preview-context",{workspaceId:"proof",entry:ref}]]);expect(view.container.querySelector("iframe")).toBeNull();
 fireEvent.change(view.getByRole("combobox"),{target:{value:"0"}});await waitFor(()=>expect(view.container.querySelector("iframe")).not.toBeNull());
 expect(mocks.read.mock.calls[1]).toEqual(["content-document-preview",{workspaceId:"proof",entry:ref,revision:context.revision,sitemapProviderId:"sitemap-filesystem",sitemapId:"main",pageId:"home",pathname:"/"}]);expect(view.getByText(/not the activated release/)).toBeTruthy();
});
it("requires matching frame/source/identity and invalidates on canonical change",async()=>{
 const view=await opened();fireEvent.change(view.getByRole("combobox"),{target:{value:"0"}});await waitFor(()=>expect(view.container.querySelector("iframe")).not.toBeNull());const frame=view.container.querySelector("iframe")!;
 const send=(extra={})=>fireEvent(window,new MessageEvent("message",{source:frame.contentWindow,origin:window.location.origin,data:{protocol:"zudo-host-document-v1",type:"ready",identity,frameId:"frame",visitorUrl:"/",...extra}}));
 send({identity:{...identity,revision:"wrong"}});expect(view.getByRole("status").textContent).toContain("Waiting");mocks.matches.mockReturnValue(false);send();expect(view.getByRole("status").textContent).toContain("Waiting");mocks.matches.mockReturnValue(true);await waitFor(()=>{send();expect(view.getByRole("status").textContent).toBe("Saved snapshot rendered");});
 fireEvent(window,new Event("native-authoring-invalidated"));expect(view.container.querySelector("iframe")).toBeNull();expect(view.getByRole("alert").textContent).toContain("Refresh");
});
it("dirty input is explicitly excluded and does not issue any save or render request",async()=>{
 mocks.read.mockResolvedValue(context);const view=render(<SavedHostContentPreview providerId={ref.providerId} entry={{...entry,values:{price:"200"}}} saveStatus="dirty"/>);await view.findByRole("combobox");expect(view.getByRole("note").textContent).toContain("not included");expect(mocks.read).toHaveBeenCalledTimes(1);expect(view.getByText(/standalone Mapping fragments are unsupported/)).toBeTruthy();
});
it("ignores stale context completion after an owner switch",async()=>{
 let release!:(value:unknown)=>void;mocks.read.mockReturnValueOnce(new Promise(r=>{release=r;})).mockResolvedValue({...context,entry:{...ref,recordId:"other"},record:{...entry,id:"other"},uses:[]});
 const view=render(<SavedHostContentPreview providerId={ref.providerId} entry={entry} saveStatus="saved"/>);await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(1));view.rerender(<SavedHostContentPreview providerId={ref.providerId} entry={{...entry,id:"other"}} saveStatus="saved"/>);await view.findByText(/No saved page/);release(context);await waitFor(()=>expect(view.queryByRole("combobox")).toBeNull());
});
it("refuses foreign rendered identity without displaying the document",async()=>{
 const view=await opened();mocks.read.mockResolvedValue({...document,identity:{...identity,rendererDigest:"foreign"}});fireEvent.change(view.getByRole("combobox"),{target:{value:"0"}});await view.findByRole("alert");expect(view.container.querySelector("iframe")).toBeNull();
});
it("navigation away invalidates rather than displaying an unrelated page as a Content use",async()=>{
 const view=await opened();fireEvent.change(view.getByRole("combobox"),{target:{value:"0"}});await waitFor(()=>expect(view.container.querySelector("iframe")).not.toBeNull());const frame=view.container.querySelector("iframe")!;await waitFor(()=>{fireEvent(window,new MessageEvent("message",{source:frame.contentWindow,origin:window.location.origin,data:{protocol:"zudo-host-document-v1",type:"leaving",identity,frameId:"frame",visitorUrl:"/"}}));expect(view.container.querySelector("iframe")).toBeNull();});expect(view.getByRole("alert").textContent).toContain("left the selected use");
});

it("clears an acknowledged frame on disconnect and does not revive it on same-epoch reconnect",async()=>{
 const view=await opened();fireEvent.change(view.getByRole("combobox"),{target:{value:"0"}});await waitFor(()=>expect(view.container.querySelector("iframe")).not.toBeNull());const frame=view.container.querySelector("iframe")!;
 const send=()=>fireEvent(window,new MessageEvent("message",{source:frame.contentWindow,origin:window.location.origin,data:{protocol:"zudo-host-document-v1",type:"ready",identity,frameId:"frame",visitorUrl:"/"}}));await waitFor(()=>{send();expect(view.getByRole("status").textContent).toBe("Saved snapshot rendered");});
 fireEvent(window,new Event("native-authoring-disconnected"));expect(view.container.querySelector("iframe")).toBeNull();fireEvent(window,new Event("native-authoring-resumed"));send();expect(view.container.querySelector("iframe")).toBeNull();expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("keeps long qualified uses intact inside shrinking inspector controls", async () => {
 const longId = "owner-".repeat(60);
 const use = {...context.uses[0], title: "Long page title ".repeat(20), pageId: longId,
  targets: [{fieldLabel: "Shared field", prop: "text", target: {providerId: "files", recordId: longId, nodeId: longId, renderedNodeId: "rendered"}}]};
 const captured = {...context, uses: [use]};
 mocks.read.mockImplementation(async op => op === "content-preview-context" ? captured : {...document, content: captured});
 const style = window.document.createElement("style");
 // jsdom proves the actual cascade and preserved accessible DOM, not pixel geometry.
 style.textContent = readFileSync(resolve(process.cwd(), "src/components/ui/ui.css"), "utf8") + readFileSync(resolve(process.cwd(), "src/features/content/styles.css"), "utf8");
 window.document.head.append(style);
 try {
  const view = render(<div class="sg-content-inspector"><SavedHostContentPreview providerId={ref.providerId} entry={entry} saveStatus="saved" /></div>);
  const select = await view.findByRole("combobox", {name: "Saved affected page"});
  expect(select.textContent).toContain(`${use.title} · / · sitemap-filesystem/main/${longId}`);
  expect(getComputedStyle(view.container.firstElementChild!).gridTemplateColumns).toBe("minmax(0, 1fr)");
  const region = view.getByRole("region", {name: "Saved affected-page preview"});
  expect(getComputedStyle(region).gridTemplateColumns).toBe("minmax(0, 1fr)");
  expect(getComputedStyle(region).overflowWrap).toBe("anywhere");
  expect(getComputedStyle(select).width).toBe("100%");
  expect(getComputedStyle(select.parentElement!).minWidth).toBe("0px");
  expect(getComputedStyle(select.parentElement!.parentElement!).gridTemplateColumns).toBe("minmax(0, 1fr)");
  fireEvent.change(select, {target: {value: "0"}});
  await waitFor(() => expect(view.container.querySelector("iframe")).not.toBeNull());
  expect(view.getByRole("list", {name: "Saved Content affected targets"}).textContent).toBe(`Shared field → files/${longId}/${longId}.text`);
  expect(view.getByText(context.revision).textContent).toBe(context.revision);
  expect(mocks.read.mock.calls[1][1]).toMatchObject({pageId: longId, revision: context.revision});
  expect(view.getByText(/standalone Mapping fragments are unsupported/)).toBeTruthy();
  expect(getComputedStyle(view.container.querySelector("iframe")!).maxWidth).toBe("100%");
 } finally { style.remove(); }
});
