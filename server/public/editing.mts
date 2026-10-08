import type { createEditingService as createInternalEditingService } from "../edit/service.js";
export type { EditRequest, EditPlan, EditReceipt } from "../edit/service.js";
/** Trusted local authoring adapter; never expose apply/undo to a proposal runner. */
export declare function createEditingService(options?: { workspaceRoot?: string }): Promise<ReturnType<typeof createInternalEditingService>>;
