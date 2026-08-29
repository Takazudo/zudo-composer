// Loaded only by the active Vite development server. Keeping these Node-side
// imports behind `ssrLoadModule` prevents production config evaluation from
// traversing the Composer filesystem implementation.
export { validateCompositionRecord } from "../../library/validate";
export { createFilesystemCompositionStore } from "../filesystem";
