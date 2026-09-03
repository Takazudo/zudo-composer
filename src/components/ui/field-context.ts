import { createContext } from "preact";
import { useContext } from "preact/hooks";

/**
 * Wiring a <Field> hands down to whichever control it wraps, so a caller never
 * repeats the id on both the label and the control.
 */
export interface FieldControlContext {
  readonly controlId: string;
  readonly describedBy?: string;
  readonly invalid: boolean;
  readonly required: boolean;
}

export const FieldContext = createContext<FieldControlContext | null>(null);

/** `null` outside a <Field> — every control keeps working standalone. */
export function useFieldControl(): FieldControlContext | null {
  return useContext(FieldContext);
}
