import type { HostedProvider, HostedAsset, JsonValue, ContentEntryRef } from "zudo-composer/hosted-content";

/** Authored once by the host. Client operations never change this definition. */
export const fixedHostDefinition = {
  route: { id: "home", pathname: "/", fragment: "questions" },
  template: { id: "approved-layout", version: "1", outlet: "main" },
  composition: { id: "home-page", templateId: "approved-layout", componentId: "host:OfferPage" },
  mapping: { providerId: "content-filesystem", pageModelId: "page", pageEntryId: "home",
    fields: { title: "title", price: "price", image: "image", notes: "notes", questions: "questions" },
    faqModelId: "faq", faqFields: { question: "question", answer: "answer" } },
} as const;
export interface OfferProjection {
  kind: "host-offer-v1";
  route: { id: string; pathname: string; fragment: string };
  template: { id: string; version: string; outlet: string };
  composition: { id: string; templateId: string; componentId: string };
  title: string; price: number; notes: string;
  image: { url: string; alt: string; caption: string; versionId: string; checksum: string };
  questions: { id: string; question: string; answer: string }[];
}
function record(value: JsonValue | undefined): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected structured Content value");
  return value;
}
function string(value: JsonValue | undefined): string {
  // An incomplete type-valid draft remains previewable; completeness belongs to submission.
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw Error("Expected Content string");
  return value;
}
/** Pure Worker-safe mapping: draft Entries participate, and the owning Content list determines order. */
export function projectHostedContent(providers: HostedProvider[], assets: HostedAsset[]): JsonValue {
  const { mapping } = fixedHostDefinition;
  const provider = providers.find((item) => item.providerId === mapping.providerId);
  const page = provider?.entries.find((entry) => entry.id === mapping.pageEntryId && entry.modelId === mapping.pageModelId);
  if (!page) throw Error("The fixed home mapping has no Content Entry");
  const value = page.values;
  const image = record(value[mapping.fields.image]);
  const assetRef = record(image.asset);
  const asset = assets.find((item) => item.providerId === assetRef.providerId && item.assetId === assetRef.assetId);
  if (!asset || image.kind !== "image") throw Error("Mapped image must resolve to the approved pinned asset catalog");
  if (typeof value[mapping.fields.price] !== "number") throw Error("Price must be a Content number");
  const references = value[mapping.fields.questions];
  if (!Array.isArray(references)) throw Error("FAQ membership must be an ordered Content reference list");
  const questions = references.map((reference) => {
    const ref = record(reference) as unknown as ContentEntryRef;
    if (ref.providerId !== mapping.providerId || ref.modelId !== mapping.faqModelId) throw Error("FAQ mapping escaped its fixed model");
    const entry = provider?.entries.find((item) => item.id === ref.recordId && item.modelId === ref.modelId);
    if (!entry) throw Error("FAQ mapping contains a dangling reference");
    return { id: entry.id, question: string(entry.values[mapping.faqFields.question]), answer: string(entry.values[mapping.faqFields.answer]) };
  });
  return { kind: "host-offer-v1", route: { ...fixedHostDefinition.route }, template: { ...fixedHostDefinition.template },
    composition: { ...fixedHostDefinition.composition }, title: string(value[mapping.fields.title]),
    price: value[mapping.fields.price]!, notes: string(value[mapping.fields.notes]),
    image: { url: asset.url, alt: string(image.alt), caption: string(image.caption), versionId: asset.versionId, checksum: asset.checksum }, questions };
}
export function offerProjection(value: JsonValue): OfferProjection {
  const data = record(value);
  if (data.kind !== "host-offer-v1") throw Error("Unsupported host projection");
  const projection = data as unknown as OfferProjection;
  if (projection.template.id !== fixedHostDefinition.template.id || projection.template.outlet !== "main"
      || projection.composition.templateId !== projection.template.id || projection.composition.componentId !== "host:OfferPage"
      || projection.route.id !== "home" || projection.route.pathname !== "/" || projection.route.fragment !== "questions") {
    throw Error("Snapshot changed approved host structure");
  }
  return projection;
}
