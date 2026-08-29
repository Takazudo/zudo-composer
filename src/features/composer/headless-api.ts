/** Browser-safe subset used by the isolated preview bundle. */
export type {
  ComponentCatalog,
  CompositionBinding,
  CompositionDocument,
  CompositionNode,
  CompositionPublication,
  GlobalTemplateOutlet,
  GlobalTemplateOutletTarget,
  InsertionTarget,
  JsonObject,
} from "../../composer/model/types";
export { COMPOSITION_SCHEMA_VERSION, VIRTUAL_ROOT_SLOT_ID, createComponentCatalog } from "../../composer/model/types";
export type { NodeDiagnostic } from "../../composer/model/validate";
export { classifyNode } from "../../composer/model/validate";
export { COMPOSITION_RECORD_ID_PATTERN } from "../../composer/library/validate";
