// Separate process: no inherited Vite/native ESM or policy epoch cache.
import { createLocalSiteProjectApiService } from "../../site-project-local/service";
import { componentCatalog } from "../../../src/site-project/compiler/__tests__/fixtures";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
const pack = { manifest: componentCatalog.pack } as unknown as TrustedComponentPack;
const toolchain = JSON.parse(process.argv[4]!);
const [workspaceRoot, raw] = process.argv.slice(2);
const service = createLocalSiteProjectApiService({ workspaceRoot, pack, toolchain });
process.stdout.write(JSON.stringify(await service.handle(JSON.parse(raw!))));
