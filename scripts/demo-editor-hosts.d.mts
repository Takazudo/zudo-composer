export const DEMO_EDITOR_HOSTS: Readonly<{
  sample: "packages/demo-sample";
  shop: "packages/demo-webshop";
  landing: "packages/demo-landing";
  blog: "packages/demo-blog";
}>;
export function resolveDemoEditorHost(target: string, options?: { root?: string; cwd?: string }): string;
