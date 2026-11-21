import {describe,it,expect,vi} from "vitest";
import {libraryResolutionCatalogs,mapLibraryRows} from "../library-discovery";
import {harness,mappingRecord,READY_BINDING,composition,model,CONTENT_REF,COMPOSITION_REF} from "./harness";

describe("Mapping library discovery",()=>{
 it("opens only the qualified selected definition despite many unrelated slow records; library return resolves every diagnostic",async()=>{
  const selected=mappingRecord([READY_BINDING],"selected");const unrelated=Array.from({length:40},(_,i)=>{const r=mappingRecord([],`unrelated-${i}`);r.document.composition={...COMPOSITION_REF,recordId:'slow'};return r;});
  const h=harness([selected,...unrelated]);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  const resolve=vi.spyOn(h.compositions,'resolve').mockImplementation(async ref=>{if(ref.recordId==='slow'){await gate;return{status:'invalid',reason:'Preserved invalid source'};}return{status:'resolved',record:composition};});
  const get=vi.spyOn(h.provider.store,'get');
  await h.controller.initialize({providerId:h.provider.descriptor.id,mappingId:selected.id});
  expect(h.controller.state.deepLink?.status).toBe('ready');expect(h.controller.state.mapping?.id).toBe(selected.id);expect(h.controller.state.definition?.status).toBe('ready');expect(resolve).toHaveBeenCalledTimes(2);expect(resolve.mock.calls.every(([ref])=>ref.recordId===COMPOSITION_REF.recordId)).toBe(true);expect(get.mock.calls.map(([id])=>id)).toEqual(['selected']);expect(h.controller.state.libraryDetails).toEqual({});
  const closing=h.controller.close();await vi.waitFor(()=>expect(resolve.mock.calls.some(([ref])=>ref.recordId==='slow')).toBe(true));expect(h.controller.state.message).toBe('Checking Mapping library…');expect(h.controller.state.libraryDetails).toEqual({});release();await closing;
  expect(Object.keys(h.controller.state.libraryDetails)).toEqual([selected,...unrelated].map(r=>r.id));expect(h.controller.state.libraryDetails['unrelated-39']?.definition.diagnostics).toContainEqual(expect.objectContaining({code:'composition-invalid',message:'Preserved invalid source'}));expect(h.controller.state.libraryDetails.selected?.definition.status).toBe('ready');expect(resolve).toHaveBeenCalledTimes(4); // existing editor resolve/evaluate + one per unique ref in a fresh library pass
 });
 it("shares identical qualified refs within each library pass, preserves order and re-reads the selected editor and next pass",async()=>{
  const records=Array.from({length:25},(_,i)=>mappingRecord([READY_BINDING],`existing-${i}`));const h=harness(records);const content=vi.spyOn(h.content,'resolveModel'),compositions=vi.spyOn(h.compositions,'resolve');
  await h.controller.initialize();expect(content).toHaveBeenCalledTimes(1);expect(compositions).toHaveBeenCalledTimes(1);expect(Object.keys(h.controller.state.libraryDetails)).toEqual(records.map(r=>r.id));
  await h.controller.open(records[0]!.id);expect(content).toHaveBeenCalledTimes(3);expect(compositions).toHaveBeenCalledTimes(3);
  await h.controller.create('New record',CONTENT_REF,COMPOSITION_REF);expect(content).toHaveBeenCalledTimes(3);expect(compositions).toHaveBeenCalledTimes(3);expect(h.controller.state.libraryDetails).toEqual({});
  await h.controller.close();expect(content).toHaveBeenCalledTimes(4);expect(compositions).toHaveBeenCalledTimes(4);expect(Object.keys(h.controller.state.libraryDetails)).toHaveLength(26);
 });
 it("does not conflate provider-qualified references or retain provider failure in the next pass",async()=>{
  const h=harness();const resolve=vi.spyOn(h.content,'resolveModel').mockImplementation(async ref=>ref.providerId==='other'?{status:'provider-error',reason:'offline'}:{status:'resolved',record:model});const first=libraryResolutionCatalogs(h);
  const values=await Promise.all([first.content.resolveModel(CONTENT_REF),first.content.resolveModel({...CONTENT_REF}),first.content.resolveModel({...CONTENT_REF,providerId:'other'})]);expect(resolve).toHaveBeenCalledTimes(2);expect(values[2]).toEqual({status:'provider-error',reason:'offline'});
  resolve.mockResolvedValue({status:'resolved',record:model});expect(await libraryResolutionCatalogs(h).content.resolveModel({...CONTENT_REF,providerId:'other'})).toEqual({status:'resolved',record:model});expect(resolve).toHaveBeenCalledTimes(3);
 });
 it("does not reuse a valid ref result for a malformed extra-key ref",async()=>{
  const h=harness();const resolve=vi.spyOn(h.content,'resolveModel').mockImplementation(async ref=>Object.keys(ref).length===2?{status:'resolved',record:model}:{status:'invalid',reason:'Malformed reference'});const scoped=libraryResolutionCatalogs(h);await scoped.content.resolveModel(CONTENT_REF);expect(await scoped.content.resolveModel({...CONTENT_REF,unexpected:true} as typeof CONTENT_REF)).toEqual({status:'invalid',reason:'Malformed reference'});expect(resolve).toHaveBeenCalledTimes(2);
 });
 it("bounds provider work and returns rows in input order even when completion differs",async()=>{
  let active=0,max=0;const result=await mapLibraryRows(Array.from({length:100},(_,i)=>i),async i=>{active++;max=Math.max(max,active);await Promise.resolve();if(i%2===0)await Promise.resolve();active--;return i;});expect(max).toBe(4);expect(active).toBe(0);expect(result).toEqual(Array.from({length:100},(_,i)=>i));
 });
 it("joins admitted responses on error without starting every queued row",async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),started:number[]=[];let settled=false;
  const result=mapLibraryRows(Array.from({length:20},(_,i)=>i),async i=>{started.push(i);if(i===0)throw Error('provider failed');await gate;return i;});const observed=result.then(()=>{settled=true;},()=>{settled=true;});await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);expect(started).toEqual([0,1,2,3]);release();await expect(result).rejects.toThrow('provider failed');await observed;expect(started).toEqual([0,1,2,3]);
 });
 it("failed qualified deep links retain their explicit failure and still resolve actual library diagnostics",async()=>{
  const r=mappingRecord([READY_BINDING]);const h=harness([r]);await h.controller.initialize({providerId:h.provider.descriptor.id,mappingId:'missing'});expect(h.controller.state.deepLink?.status).toBe('missing');expect(h.controller.state.mapping).toBeNull();expect(h.controller.state.libraryDetails[r.id]?.definition.status).toBe('ready');
 });
});

describe("library rows from one snapshot", () => {
  it("resolves every library row from one Mapping snapshot instead of one get per row", async () => {
    const records = Array.from({ length: 40 }, (_, i) => mappingRecord([READY_BINDING], `bulk-${i}`)); const h = harness(records);
    const get = vi.spyOn(h.provider.store, "get");
    const snapshot = vi.fn(async () => ({ mutationToken: "t", records }));
    Object.assign(h.provider.store, { snapshot });
    await h.controller.initialize();
    expect(snapshot).toHaveBeenCalledTimes(1); expect(get).not.toHaveBeenCalled();
    expect(Object.keys(h.controller.state.libraryDetails)).toEqual(records.map((r) => r.id));
  });
});

it("resolves library rows without waiting for a slow or stuck attachments capture", async () => {
  const records = Array.from({ length: 5 }, (_, i) => mappingRecord([READY_BINDING], `rows-${i}`));
  const attachments = { list: () => new Promise<never>(() => {}) } as unknown as NonNullable<NonNullable<Parameters<typeof harness>[2]>["attachments"]>;
  const h = harness(records, undefined, { attachments });
  void h.controller.initialize();
  await vi.waitFor(() => expect(Object.keys(h.controller.state.libraryDetails)).toEqual(records.map((r) => r.id)));
});
