import { join } from "node:path";
import { SafeRootFilesystem, commitDocument, type DurableExtraErrorCode } from "../../src/shared/node-fs";

export class EditError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Detached plans are append-only; mutable disposition is a separate record. */
export async function openPlans(dataRoot: string) {
  const fs = await SafeRootFilesystem.create<"edit", DurableExtraErrorCode>({
    root: join(dataRoot, "edit-plans"), initializeOperation: "edit", rootLabel: "Edit plans", ownerLabel: "Edit plans", recordLabel: "plan",
    errors: {
      isError: value => value instanceof EditError,
      create: (_op, code, message) => new EditError(code, message),
      rethrow: (_op, code, message, cause): never => { if (cause instanceof EditError) throw cause; throw new EditError(code, message); },
    },
  });
  const path = (id: string, suffix: string) => {
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(id)) throw new EditError("invalid-request", "Invalid plan identifier.");
    return fs.ownedPath(`${id}.${suffix}.json`);
  };
  return {
    async read<T>(id: string): Promise<T> {
      const value = await fs.readFileNoFollow("edit", path(id, "plan"));
      if (!value) throw new EditError("not-found", "Plan not found in this host.");
      return JSON.parse(value.text) as T;
    },
    async create(id: string, value: unknown) {
      if (await fs.readFileNoFollow("edit", path(id, "plan"))) throw new EditError("conflict", "Plan already exists.");
      await commitDocument(fs, "edit", path(id, "plan"), `${JSON.stringify(value, null, 2)}\n`);
    },
    async status(id: string): Promise<string> {
      const value = await fs.readFileNoFollow("edit", path(id, "state"));
      return value ? (JSON.parse(value.text) as { status: string }).status : "pending";
    },
    async disposition(id: string, status: string, supersededBy?: string) {
      await commitDocument(fs, "edit", path(id, "state"), JSON.stringify({ status, ...(supersededBy ? { supersededBy } : {}) }));
    },
  };
}
