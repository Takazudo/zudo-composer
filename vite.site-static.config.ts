import { defineConfig } from "vite";
import { resolveStaticSiteConfig } from "./server/site-build/vite-config";

// Repository adapter; the installed CLI loads the same shipped configuration.
export default defineConfig(() => resolveStaticSiteConfig());
