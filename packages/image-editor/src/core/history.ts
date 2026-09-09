import type { EditDoc } from "./types";
import { ImageEditorError } from "./limits";
export class EditHistory {
  private entries: string[];
  private cursor = 0;
  private readonly baselineValue: string;
  get baseline(): EditDoc {
    return JSON.parse(this.baselineValue);
  }
  constructor(
    doc: EditDoc,
    private readonly byteBudget = 256 * 1024 * 1024,
    private readonly maxEntries = 100,
  ) {
    if (
      !Number.isSafeInteger(byteBudget) ||
      byteBudget < 1 ||
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1
    )
      throw new ImageEditorError("invalid-document");
    this.baselineValue = JSON.stringify(doc);
    this.entries = [JSON.stringify(doc)];
    this.check(this.entries[0]);
  }
  private bytes(s: string) {
    return new TextEncoder().encode(s).length;
  }
  private check(s: string) {
    if (this.bytes(s) + this.bytes(this.baselineValue) > this.byteBudget)
      throw new ImageEditorError("memory-limit");
  }
  get current(): EditDoc {
    return JSON.parse(this.entries[this.cursor]);
  }
  get canUndo() {
    return this.cursor > 0;
  }
  get canRedo() {
    return this.cursor < this.entries.length - 1;
  }
  get byteLength() {
    return this.entries.reduce(
      (sum, s) => sum + this.bytes(s),
      this.bytes(this.baselineValue),
    );
  }
  get length() {
    return this.entries.length;
  }
  commit(doc: EditDoc) {
    const value = JSON.stringify(doc);
    this.check(value);
    if (value === this.entries[this.cursor]) return;
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push(value);
    while (
      this.entries.length > this.maxEntries ||
      this.byteLength > this.byteBudget
    )
      this.entries.shift();
    this.cursor = this.entries.length - 1;
  }
  undo() {
    if (this.canUndo) this.cursor--;
    return this.current;
  }
  redo() {
    if (this.canRedo) this.cursor++;
    return this.current;
  }
  reset() {
    this.commit(this.baseline);
    return this.current;
  }
}
export const createHistory = (
  doc: EditDoc,
  options: { byteBudget?: number; maxEntries?: number } = {},
) => new EditHistory(doc, options.byteBudget, options.maxEntries);
