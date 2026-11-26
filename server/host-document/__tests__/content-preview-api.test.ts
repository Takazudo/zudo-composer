import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { composer } from "../../config/config";
import { initializeAuthoringWorkspace } from "../../edit/initialize-workspace";
import { acquireAuthoringLease } from "../../edit/authoring-lease.mjs";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";
import { createFilesystemContentStore } from "../../../src/content/storage/filesystem/store";
import { workspaceDomainRoots } from "../../../src/shared/workspace-scope";
import * as realCapture from "../../authoring-workspace/capture";
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import type { ViteDevServer } from "vite";
import { httpRequest, httpResponse } from "../../../plugins/__tests__/test-helpers";
import { contentPreviewFixture } from "./content-preview-fixture";
import * as rendering from "../render";
const mocks=vi.hoisted(()=>({context:undefined as unknown, renderer:{renderDocument:vi.fn(async()=>'<html><head></head><body>Real host</body></html>')}}));
vi.mock("../../host-context.mjs",()=>({loadHostContext:async()=>mocks.context}));
vi.mock("../../module-evaluator.mjs",()=>({createModuleEvaluator:()=>async()=>mocks.renderer}));
vi.mock("../../../plugins/component-pack.mjs",()=>({resolveComponentPack:()=>({entryPath:"test-renderer"})}));
import { installNativeEditApi } from "../../../plugins/native-edit-api";
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();vi.clearAllMocks();});
async function fixture(realStorage=false){
 const data=await contentPreviewFixture();const paths={data:"/missing-test/data",compositions:"/missing-test/compositions",content:"/missing-test/content",mappings:"/missing-test/mappings",sitemaps:"/missing-test/sitemaps",assets:"/missing-test/assets"};
 mocks.context={pack:data.pack,packIdentity:{},composerConfig:{workspaceRoot:"/missing-test",paths,hostDocument:{module:"test/renderer",jsxImportSource:"preact",rendererId:"host",rendererVersion:"1"}}};
 const capture={captureAuthoringWorkspace:vi.fn(async()=>data.snapshot),compileAuthoringWorkspaceSnapshot:vi.fn(async()=>data.compiled),resolveAuthoringRendererIdentity:vi.fn(async()=>data.snapshot.renderer),resolveAuthoringPackIdentity:vi.fn(async()=>({})),isAuthoringWorkspaceSnapshotCurrent:vi.fn(async()=>true)};
 let actualLease: Awaited<ReturnType<typeof acquireAuthoringLease>> | undefined;
 let readSnapshot: (()=>Promise<realCapture.AuthoringWorkspaceSnapshot>) | undefined;
 let contentStore: Awaited<ReturnType<typeof createFilesystemContentStore>> | undefined;
 if(realStorage){
  const workspaceRoot=await mkdtemp(join(tmpdir(),"content-preview-api-"));cleanup.push(()=>rm(workspaceRoot,{recursive:true}));
  const composerConfig=composer({workspaceRoot,pack:"proof/components",authoringAuthority:"workspace",nativeEditing:{source:"workspace"},hostDocument:{module:"proof/renderer",jsxImportSource:"preact",rendererId:"host",rendererVersion:"1"}},{env:{}});
  await createFilesystemAssetStore({assetsStoreRoot:composerConfig.paths.assets});
  await initializeAuthoringWorkspace({composerConfig,pack:data.pack,project:data.snapshot.project,workspaceId:"proof"});
  const packIdentity={specifier:"proof/components",source:"self",digest:"a".repeat(64),compiler:"proof",contractDigest:"c".repeat(64)};
  const renderer={id:"host",version:"1",module:"proof/renderer",digest:"b".repeat(64)};
  const options={composerConfig,pack:data.pack,packIdentity,renderer};
  mocks.context={composerConfig,pack:data.pack,packIdentity};
  capture.captureAuthoringWorkspace.mockImplementation(()=>realCapture.captureAuthoringWorkspace(options));
  capture.compileAuthoringWorkspaceSnapshot.mockImplementation(async()=>{throw Error("Use passed snapshot");});
  // The actual API passes its exact captured snapshot into the public compiler.
  Object.assign(capture,{compileAuthoringWorkspaceSnapshot:vi.fn((input:Parameters<typeof realCapture.compileAuthoringWorkspaceSnapshot>[0])=>realCapture.compileAuthoringWorkspaceSnapshot(input)),isAuthoringWorkspaceSnapshotCurrent:vi.fn((input:Parameters<typeof realCapture.isAuthoringWorkspaceSnapshotCurrent>[0],snapshot:Parameters<typeof realCapture.isAuthoringWorkspaceSnapshotCurrent>[1])=>realCapture.isAuthoringWorkspaceSnapshotCurrent(input,snapshot))});
  capture.resolveAuthoringRendererIdentity.mockResolvedValue(renderer);capture.resolveAuthoringPackIdentity.mockResolvedValue(packIdentity);
  contentStore=await createFilesystemContentStore({contentRoot:workspaceDomainRoots({compositions:composerConfig.paths.compositions,content:composerConfig.paths.content,mappings:composerConfig.paths.mappings,sitemaps:composerConfig.paths.sitemaps},"proof").content});
  actualLease=await acquireAuthoringLease(workspaceRoot,"saved-preview-test");cleanup.push(()=>actualLease!.release());readSnapshot=()=>actualLease!.execute(()=>realCapture.captureAuthoringWorkspace(options));
 }
 const handlers=new Map<string, (...args:unknown[])=>void>();let middleware: ((...args:unknown[])=>Promise<void>)|undefined;
 const loadModule = vi.fn(async (id: string) => {
  if (id.endsWith("server/edit/service.ts")) return { createEditingService: () => ({ initializeSourceEpoch: vi.fn(async () => {}) }) };
  if (id.endsWith("server/authoring-workspace/capture.ts")) return capture;
  if (id.endsWith("server/host-document/render.ts")) return rendering;
  throw Error(id);
 });
 const server={config:{server:{https:false}},ws:{on:(name:string,fn:(...args:unknown[])=>void)=>handlers.set(name,fn),send:vi.fn()},watcher:{on:vi.fn()},middlewares:{use:(fn:typeof middleware)=>{middleware=fn;}},ssrLoadModule:loadModule};
 const lease={execute:vi.fn(async(action:()=>Promise<unknown>)=>actualLease?actualLease.execute(action):action())};const api=await installNativeEditApi(server as unknown as ViteDevServer,lease as never,"/missing-test");cleanup.push(api.close);
 const socket=new EventEmitter(),peer={socket,send:vi.fn()};handlers.get('connection')!(socket,{headers:{host:'127.0.0.1:4300',origin:'http://127.0.0.1:4300'}});const clientId='10000000-1000-4000-8000-000000000001';handlers.get('native:bind')!({clientId,capability:api.config.capability,epoch:null},peer);
 expect(peer.send).toHaveBeenCalledWith('native:bound',expect.objectContaining({epoch:0}));peer.send.mockClear();
 const call=async(operation:string,input:unknown,epoch=0)=>{const request=httpRequest([Buffer.from(JSON.stringify({operation,input}))]);request.url='/__zudo-native-edit';request.method='POST';request.headers={host:'127.0.0.1:4300',origin:'http://127.0.0.1:4300','content-type':'application/json','x-zudo-native-capability':api.config.capability,'x-zudo-native-client':clientId,'x-zudo-native-epoch':String(epoch)};Object.defineProperties(request.socket,{remoteAddress:{value:'127.0.0.1'},localPort:{value:4300}});const response=httpResponse();await middleware!(request,response,()=>{throw Error('unexpected next');});return{status:response.statusCode,body:JSON.parse(String(response.end.mock.calls[0]![0]))};};
 return{...data,capture,lease,peer,call,contentStore,readSnapshot,loadModule};
}
const input={workspaceId:'proof',entry:{providerId:'content-filesystem',modelId:'course',recordId:'consultation'}};
it("captures with the verified renderer identity and checks it anew on the next request", async () => {
 const f = await fixture();
 const resolveRenderer = f.capture.resolveAuthoringRendererIdentity;
 resolveRenderer.mockClear();

 const verified = { ...f.snapshot.renderer };
 resolveRenderer.mockResolvedValueOnce(verified);
 expect((await f.call("content-preview-context", input)).status).toBe(200);
 expect(resolveRenderer).toHaveBeenCalledTimes(1);
 expect(f.capture.captureAuthoringWorkspace).toHaveBeenCalledWith(expect.objectContaining({ renderer: verified }));

 const originalLoad = f.loadModule.getMockImplementation()!;
 f.loadModule.mockImplementation(async id => {
  const loaded = await originalLoad(id);
  if (id.endsWith("server/host-document/render.ts")) resolveRenderer.mockResolvedValueOnce({ ...verified, digest: "d".repeat(64) });
  return loaded;
 });
 const stale = await f.call("content-preview-context", input);
 expect(stale.status).toBe(409);
 expect(stale.body.error.code).toBe("stale-plan");
 expect(resolveRenderer).toHaveBeenCalledTimes(2);
 expect(f.capture.captureAuthoringWorkspace).toHaveBeenCalledTimes(1);
 expect(mocks.renderer.renderDocument).not.toHaveBeenCalled();
});
it('actual native endpoint discovers and renders with one capture/compile per read, no dirty-tab prepare or mutation',async()=>{
 const f=await fixture(),first=await f.call('content-preview-context',input);expect(first.status).toBe(200);expect(first.body.result.uses).toHaveLength(1);expect(f.capture.captureAuthoringWorkspace).toHaveBeenCalledTimes(1);expect(f.capture.compileAuthoringWorkspaceSnapshot).toHaveBeenCalledTimes(1);expect(mocks.renderer.renderDocument).not.toHaveBeenCalled();
 const use=first.body.result.uses[0];const second=await f.call('content-document-preview',{...input,revision:first.body.result.revision,sitemapProviderId:use.sitemapProviderId,sitemapId:use.sitemapId,pageId:use.pageId,pathname:use.pathname});expect(second.status).toBe(200);expect(second.body.result.identity.revision).toBe(first.body.result.revision);expect(second.body.result.content.entry).toEqual(input.entry);expect(mocks.renderer.renderDocument).toHaveBeenCalledTimes(1);expect(f.capture.captureAuthoringWorkspace).toHaveBeenCalledTimes(2);expect(f.capture.compileAuthoringWorkspaceSnapshot).toHaveBeenCalledTimes(2);expect(f.lease.execute).toHaveBeenCalledTimes(2);expect(f.peer.send).not.toHaveBeenCalled();
});
it('actual native endpoint refuses stale browser, changed captured state and stale context before returning a frame',async()=>{
 const f=await fixture();expect((await f.call('content-preview-context',input,9)).body.error.code).toBe('stale-browser');expect(f.capture.captureAuthoringWorkspace).not.toHaveBeenCalled();
 f.capture.isAuthoringWorkspaceSnapshotCurrent.mockResolvedValue(false);expect((await f.call('content-preview-context',input)).body.error.code).toBe('stale-plan');expect(f.peer.send).not.toHaveBeenCalled();
 f.capture.isAuthoringWorkspaceSnapshotCurrent.mockResolvedValue(true);const first=await f.call('content-preview-context',input);const use=first.body.result.uses[0];const request={...input,revision:'c'.repeat(64),sitemapProviderId:use.sitemapProviderId,sitemapId:use.sitemapId,pageId:use.pageId,pathname:use.pathname};expect((await f.call('content-document-preview',request)).body.error.code).toBe('stale-plan');expect(mocks.renderer.renderDocument).not.toHaveBeenCalled();
 mocks.renderer.renderDocument.mockImplementationOnce(async()=>{f.capture.isAuthoringWorkspaceSnapshotCurrent.mockResolvedValue(false);return '<html><body>Concurrent saved change</body></html>';});request.revision=first.body.result.revision;expect((await f.call('content-document-preview',request)).body.error.code).toBe('stale-plan');expect(f.peer.send).not.toHaveBeenCalled();
});

it('real leased capture returns saved state without queue flush and refuses an actual durable write raced during rendering',async()=>{
 const f=await fixture(true),before=await f.contentStore!.readAll(),wholeBefore=await f.readSnapshot!();
 const first=await f.call('content-preview-context',input);expect(first.status).toBe(200);expect(first.body.result.record).toEqual(before.entries.find(entry=>entry.id==='consultation'));expect(await f.contentStore!.readAll()).toEqual(before);expect(await f.readSnapshot!()).toEqual(wholeBefore);expect(f.peer.send).not.toHaveBeenCalled();
 const use=first.body.result.uses[0];mocks.renderer.renderDocument.mockImplementationOnce(async()=>{const entry=structuredClone(before.entries.find(entry=>entry.id==='consultation')!);entry.values['course-price']='Changed during render';await f.contentStore!.putEntry(entry);return '<html><body>Earlier captured price</body></html>';});
 const response=await f.call('content-document-preview',{...input,revision:first.body.result.revision,sitemapProviderId:use.sitemapProviderId,sitemapId:use.sitemapId,pageId:use.pageId,pathname:use.pathname});
 expect(response.status).toBe(409);expect(response.body.error.code).toBe('stale-plan');expect(response.body.result).toBeUndefined();const after=await f.contentStore!.readAll();expect(after.mutationToken).toBeGreaterThan(before.mutationToken);expect(after.entries.find(entry=>entry.id==='consultation')!.values['course-price']).toBe('Changed during render');expect(f.peer.send).not.toHaveBeenCalled();
});
