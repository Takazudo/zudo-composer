import {
  ContractValidationError,
  RESERVED_PERSISTED_KEYS,
  validateFieldValue,
  type JsonValue,
} from "@zudo-composer/component-contract";
import type { ComponentDefinition, CompositionNode } from "./types";

export type NodePropIssueCode =
  | "reserved-prop"
  | "slot-backed-prop"
  | "unknown-prop"
  | "invalid-field-value"
  | "static-prop-mismatch";

export interface NodePropIssue {
  code: NodePropIssueCode;
  prop: string;
  message: string;
}

export type NodePropValidation =
  | { ok: true; issues: readonly [] }
  | { ok: false; issues: readonly NodePropIssue[] };

const reservedProps = new Set<string>(RESERVED_PERSISTED_KEYS);

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = [...left].map((point) => point.codePointAt(0)!);
  const rightPoints = [...right].map((point) => point.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!;
  }
  return leftPoints.length - rightPoints.length;
}

function equalJson(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => equalJson(value, right[index]!));
  }
  const leftObject = left as { readonly [key: string]: JsonValue };
  const rightObject = right as { readonly [key: string]: JsonValue };
  const leftKeys = Object.keys(leftObject).sort(compareUnicodeCodePoints);
  const rightKeys = Object.keys(rightObject).sort(compareUnicodeCodePoints);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && equalJson(leftObject[key]!, rightObject[key]!));
}

/**
 * Validate persisted scalar props against one manifest component contract.
 * Static props are legitimate only when the manifest supplies their exact
 * trusted default; callers cannot smuggle a replacement static value through
 * a Composition document.
 */
export function validateNodeProps(
  node: Pick<CompositionNode, "componentId" | "props">,
  component: ComponentDefinition,
): NodePropValidation {
  const issues: NodePropIssue[] = [];
  const fields = new Map(component.fields.map((field) => [field.prop, field]));
  const slotProps = new Set(component.slots.map((slot) => slot.prop));
  const staticProps = new Set((component.staticProps ?? []).map((entry) => entry.prop));

  for (const prop of Object.keys(node.props).sort(compareUnicodeCodePoints)) {
    const value = node.props[prop]!;
    if (reservedProps.has(prop)) {
      issues.push({ code: "reserved-prop", prop, message: `Prop "${prop}" is reserved and cannot be persisted.` });
      continue;
    }
    if (slotProps.has(prop)) {
      issues.push({ code: "slot-backed-prop", prop, message: `Prop "${prop}" is structural slot content and cannot be persisted as a scalar prop.` });
      continue;
    }
    const field = fields.get(prop);
    if (field) {
      try {
        validateFieldValue(field, value, `$props.${prop}`);
      } catch (error) {
        if (!(error instanceof ContractValidationError)) throw error;
        issues.push({ code: "invalid-field-value", prop, message: `Prop "${prop}" does not match its field contract: ${error.message}` });
      }
      continue;
    }
    if (staticProps.has(prop)) {
      if (!Object.hasOwn(component.defaults, prop) || !equalJson(value, component.defaults[prop]!)) {
        issues.push({ code: "static-prop-mismatch", prop, message: `Static prop "${prop}" must match its manifest default.` });
      }
      continue;
    }
    issues.push({ code: "unknown-prop", prop, message: `Prop "${prop}" is not declared by component "${node.componentId}".` });
  }
  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}
