import {describe,it,expect,vi} from 'vitest';
import {harness,mappingRecord,READY_BINDING,CONTENT_REF,COMPOSITION_REF,composition,HEADING_TARGET,entry} from './harness';
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return{promise,release};};
async function selectedWithSlowLibrary(){
 const selected=mappingRecord([READY_BINDING],'selected'),other=mappingRecord([],'unrelated');other.document.composition={...COMPOSITION_REF,recordId:'unrelated-composition'};
 const h=harness([selected,other]),slow=gate();
 const resolve=vi.spyOn(h.compositions,'resolve').mockImplementation(async ref=>{if(ref.recordId==='unrelated-composition'){await slow.promise;return{status:'invalid',reason:'Unrelated source diagnostic retained'};}return{status:'resolved',record:composition};});
 await h.controller.initialize({providerId:h.provider.descriptor.id,mappingId:selected.id});return{...h,selected,other,slow,resolve};
}
describe('durable Mapping editor completion',()=>{
 it('completes one acknowledged selected save without unrelated reads, then joins full diagnostics on library return',async()=>{
  const h=await selectedWithSlowLibrary(),put=vi.spyOn(h.provider.store,'put'),list=vi.spyOn(h.provider.store,'list');
  h.controller.rename('Saved selected');await h.controller.flush();expect(put).toHaveBeenCalledTimes(1);expect(list).not.toHaveBeenCalled();expect(h.resolve.mock.calls.every(([ref])=>ref.recordId===COMPOSITION_REF.recordId)).toBe(true);expect(h.controller.state.saveStatus).toBe('saved');expect(h.records.get('selected')?.document.name).toBe('Saved selected');expect(h.controller.state.libraryDetails).toEqual({});
  let closed=false;const closing=h.controller.close().then(()=>{closed=true;});await vi.waitFor(()=>expect(h.resolve.mock.calls.some(([ref])=>ref.recordId==='unrelated-composition')).toBe(true));expect(closed).toBe(false);expect(h.controller.state.message).toBe('Checking Mapping library…');h.slow.release();await closing;
  expect(h.controller.state.libraryDetails.selected?.record.document.name).toBe('Saved selected');expect(h.controller.state.libraryDetails.unrelated?.definition.diagnostics).toContainEqual(expect.objectContaining({message:'Unrelated source diagnostic retained'}));expect(put).toHaveBeenCalledTimes(1);
 });
 for(const action of ['create','duplicate'] as const)it(`${action} waits for its write, returns its editor destination without unrelated detail fanout, and resolves selected editor afresh`,async()=>{
  const h=await selectedWithSlowLibrary(),write=gate(),original=h.provider.store.put.bind(h.provider.store);const put=vi.spyOn(h.provider.store,'put').mockImplementation(async record=>{await write.promise;await original(record);});let destination:string|undefined;
  const creating=(action==='create'?h.controller.create('New selected',CONTENT_REF,COMPOSITION_REF):h.controller.duplicate('selected')).then(id=>{destination=id;return id;});await vi.waitFor(()=>expect(put).toHaveBeenCalledTimes(1));expect(destination).toBeUndefined();write.release();const id=await creating;expect(h.records.has(id)).toBe(true);expect(h.resolve.mock.calls.every(([ref])=>ref.recordId===COMPOSITION_REF.recordId)).toBe(true);expect(h.controller.state.libraryDetails).toEqual({});
  const before=h.resolve.mock.calls.length;await h.controller.open(id);expect(h.resolve.mock.calls.length).toBeGreaterThan(before);expect(h.controller.state.mapping?.id).toBe(id);expect(h.controller.state.definition?.status).toBe('ready');h.slow.release();await h.controller.close();expect(Object.keys(h.controller.state.libraryDetails)).toHaveLength(3);expect(h.controller.state.libraryDetails.unrelated?.definition.status).not.toBe('ready');
 });
 it('does not mark saved or write before the actual selected binding resolution settles',async()=>{
  const h=await selectedWithSlowLibrary(),selected=gate(),original=h.compositions.resolve.bind(h.compositions);vi.spyOn(h.compositions,'resolve').mockImplementationOnce(async ref=>{await selected.promise;return original(ref);});const put=vi.spyOn(h.provider.store,'put');
  const binding=h.controller.bindEntryIdentity(HEADING_TARGET,READY_BINDING.id);const saving=h.controller.flush();await Promise.resolve();expect(put).not.toHaveBeenCalled();expect(h.controller.state.saveStatus).toBe('saving');selected.release();await Promise.all([binding,saving]);expect(put).toHaveBeenCalledTimes(1);expect(h.controller.state.previewDocument?.root[0]?.props[HEADING_TARGET.prop]).toBe(entry.id);expect(h.controller.state.saveStatus).toBe('saved');h.slow.release();
 });
 it('keeps selected resolution errors visible and refuses its save until explicit resolution retry succeeds',async()=>{
  const h=await selectedWithSlowLibrary();vi.spyOn(h.compositions,'resolve').mockRejectedValueOnce(Error('Selected provider failed'));const put=vi.spyOn(h.provider.store,'put');await expect(h.controller.bindEntryIdentity(HEADING_TARGET,READY_BINDING.id)).rejects.toThrow('Selected provider failed');await expect(h.controller.flush()).rejects.toThrow('Selected provider failed');expect(put).not.toHaveBeenCalled();expect(h.controller.state.saveStatus).toBe('error');await h.controller.testDefinition();await h.controller.retrySave();expect(put).toHaveBeenCalledTimes(1);expect(h.controller.state.saveStatus).toBe('saved');h.slow.release();
 });
 it('does not claim a failed store write saved or return a created destination',async()=>{
  const h=await selectedWithSlowLibrary();vi.spyOn(h.provider.store,'put').mockRejectedValue(Error('disk failed'));h.controller.rename('Unsaved');await expect(h.controller.flush()).rejects.toThrow('disk failed');expect(h.controller.state.saveStatus).toBe('error');expect(h.records.get('selected')?.document.name).not.toBe('Unsaved');expect(h.controller.state.mappings.find(row=>row.id==='selected')?.name).not.toBe('Unsaved');h.slow.release();
  const fresh=harness();await fresh.controller.initialize();vi.spyOn(fresh.provider.store,'put').mockRejectedValue(Error('disk failed'));await expect(fresh.controller.create('New',CONTENT_REF,COMPOSITION_REF)).rejects.toThrow('disk failed');expect(fresh.records.size).toBe(0);expect(fresh.controller.state.mappings).toEqual([]);
 });
 it('drains a newer dirty binding through the same save without reporting an intermediate record saved',async()=>{
  const h=await selectedWithSlowLibrary(),write=gate(),original=h.provider.store.put.bind(h.provider.store),statuses:string[]=[];const put=vi.spyOn(h.provider.store,'put').mockImplementationOnce(async record=>{await write.promise;await original(record);});h.controller.subscribe(state=>{if(state.saveStatus==='saved')statuses.push(state.mapping?.document.name??'');});h.controller.rename('First');const first=h.controller.flush();await vi.waitFor(()=>expect(put).toHaveBeenCalledTimes(1));h.controller.rename('Latest');const joined=h.controller.flush();write.release();await Promise.all([first,joined]);expect(put).toHaveBeenCalledTimes(2);expect(h.records.get('selected')?.document.name).toBe('Latest');expect(statuses).not.toContain('First');expect(statuses.at(-1)).toBe('Latest');h.slow.release();
 });
 it('deletion still waits for complete unrelated library diagnostics',async()=>{
  const h=await selectedWithSlowLibrary();let deleted=false;const deleting=h.controller.delete('selected').then(()=>{deleted=true;});await vi.waitFor(()=>expect(h.resolve.mock.calls.some(([ref])=>ref.recordId==='unrelated-composition')).toBe(true));expect(h.records.has('selected')).toBe(false);expect(deleted).toBe(false);h.slow.release();await deleting;expect(h.controller.state.mapping).toBeNull();expect(Object.keys(h.controller.state.libraryDetails)).toEqual(['unrelated']);expect(h.controller.state.libraryDetails.unrelated?.definition.status).not.toBe('ready');
 });
 it('an older in-flight library pass cannot replace readiness after a newer acknowledged edit',async()=>{
  const h=await selectedWithSlowLibrary();const closing=h.controller.close();await vi.waitFor(()=>expect(h.resolve.mock.calls.some(([ref])=>ref.recordId==='unrelated-composition')).toBe(true));await h.controller.open('selected');h.controller.rename('Newer persisted value');await h.controller.flush();h.slow.release();await closing;
  expect(h.controller.state.mapping?.document.name).toBe('Newer persisted value');expect(h.controller.state.saveStatus).toBe('saved');expect(h.controller.state.libraryDetails).toEqual({});expect(h.controller.state.message).toBe('All changes saved.');await h.controller.close();expect(h.controller.state.libraryDetails.selected?.record.document.name).toBe('Newer persisted value');expect(Object.keys(h.controller.state.libraryDetails)).toHaveLength(2);
 });
 it('a library read error after return does not turn an acknowledged save into a write retry',async()=>{
  const h=await selectedWithSlowLibrary(),put=vi.spyOn(h.provider.store,'put');h.controller.rename('Persisted');await h.controller.flush();vi.spyOn(h.provider.store,'list').mockRejectedValueOnce(Error('Library unavailable'));await expect(h.controller.close()).rejects.toThrow('Library unavailable');expect(h.controller.state.saveStatus).toBe('saved');expect(put).toHaveBeenCalledTimes(1);h.slow.release();await h.controller.close();expect(put).toHaveBeenCalledTimes(1);expect(h.controller.state.libraryDetails.selected?.record.document.name).toBe('Persisted');
 });

});
