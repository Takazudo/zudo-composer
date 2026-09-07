// The public export every component's `source.module` names. Generated
// compositions import from here, so it must stay a public bare-package import:
// no `src` segment may appear in the specifier the contract sees.
export { Note, Panel } from "./components";
export type { NoteProps, PanelProps } from "./components";
