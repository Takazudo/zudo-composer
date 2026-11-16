import { z } from "zod";
const name = z.string().min(1).max(256);
export const hostSelectionSchema = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), pathname: name.refine(value => value.startsWith("/") && !value.startsWith("//")), target: z.object({ renderedNodeId: name, providerId: name, recordId: name, nodeId: name }).strict(), prop: name.optional() }).strict();
