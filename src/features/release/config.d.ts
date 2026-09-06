declare module "virtual:release-config" {
  const config: { endpoint: string; capability: string } | null;
  export default config;
}
