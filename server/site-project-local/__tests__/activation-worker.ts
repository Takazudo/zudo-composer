import { createLocalSiteProjectStore } from "../store";
import { componentCatalog } from "../../../src/site-project/compiler/__tests__/fixtures";
const result = await createLocalSiteProjectStore({ testRoot: process.argv[2], lockTimeoutMs: 100, componentPack: componentCatalog.pack }).activate({ target: JSON.parse(process.argv[3]!), expectedActive: JSON.parse(process.argv[4]!) });
process.stdout.write(JSON.stringify(result));
