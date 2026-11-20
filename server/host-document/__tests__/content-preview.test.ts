import { expect, it } from "vitest";
import { describeHostContent, selectHostContentUse, hostContentContextInput, hostContentDocumentInput } from "../content-preview";


import { contentPreviewFixture as fixture } from "./content-preview-fixture";

const entry = {providerId: "content-filesystem", modelId: "course", recordId: "consultation"};
it("discovers only actual compiled bindings, never unused Mapping definitions", async () => {
 const f=await fixture(), result=describeHostContent(f.snapshot,f.compiled,f.manifest,{workspaceId:"proof",entry});
 expect(result.mode).toBe("saved-page");expect(result.record.id).toBe(entry.recordId);expect(result.uses).toHaveLength(1);
 expect(result.uses[0]).toMatchObject({pathname:"/",pageId:"home",sitemapId:"main",targets:[{fieldId:"course-price",prop:"text",target:{recordId:"presentation",nodeId:"copy"}}]});
 expect(result.unsupported).toContain("Unsaved Content drafts");expect(result.uses[0]!.targets.some(target=>target.prop==="other")).toBe(false);
 const selected={workspaceId:"proof",entry,revision:result.revision,...result.uses[0]!};
 expect(selectHostContentUse(result,selected)).toEqual(result.uses[0]);
 for(const change of [{revision:"c".repeat(64)},{pathname:"/other"},{sitemapProviderId:"foreign"},{sitemapId:"other"},{pageId:"other"}])expect(()=>selectHostContentUse(result,{...selected,...change})).toThrow();
});
it("refuses wrong workspace, qualified owner collisions and unknown entries",async()=>{
 const f=await fixture();for(const input of [{workspaceId:"foreign",entry},{workspaceId:"proof",entry:{...entry,providerId:"foreign"}},{workspaceId:"proof",entry:{...entry,modelId:"foreign"}},{workspaceId:"proof",entry:{...entry,recordId:"missing"}}])expect(()=>describeHostContent(f.snapshot,f.compiled,f.manifest,input)).toThrow();
});
it("does not infer a route for a valid but unused entry",async()=>{
 const f=await fixture();const copy=structuredClone(f.snapshot);const record=structuredClone(copy.project.providers.content[0]!.entries[0]!);record.id="unplaced";copy.project.providers.content[0]!.entries.push(record);
 expect(describeHostContent(copy,f.compiled,f.manifest,{workspaceId:"proof",entry:{...entry,recordId:"unplaced"}}).uses).toEqual([]);
});
it("requires strict explicit selection and never accepts mutation payloads",()=>{
 expect(hostContentContextInput.safeParse({workspaceId:"proof",entry,save:true}).success).toBe(false);
 expect(hostContentDocumentInput.safeParse({workspaceId:"proof",entry,revision:"a".repeat(64)}).success).toBe(false);
});

it("retains distinct qualified affected routes instead of choosing the first",async()=>{
 const f=await fixture(true),context=describeHostContent(f.snapshot,f.compiled,f.manifest,{workspaceId:"proof",entry});expect(context.uses.map(use=>[use.pageId,use.pathname])).toEqual([["home","/"],["lessons","/lessons"]]);
 const use=context.uses[1]!;expect(selectHostContentUse(context,{workspaceId:"proof",entry,revision:context.revision,...use}).pageId).toBe("lessons");
});
