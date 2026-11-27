import type { ReadonlySignal } from "@takazudo/zfb/zudo-react";

/**
 * Wiring a <Field> hands to the control it wraps, so a caller never repeats the
 * id on both the label and the control. There is no ambient context: `Field`
 * calls its `children` function with this object and the control takes it as
 * its `field` prop. A control rendered without one keeps working standalone.
 */
export interface FieldControl {
  readonly controlId: string;
  /** Help and error ids, present only while each text is shown. */
  readonly describedBy: ReadonlySignal<string | undefined>;
  readonly invalid: ReadonlySignal<boolean>;
  readonly required: boolean;
}
