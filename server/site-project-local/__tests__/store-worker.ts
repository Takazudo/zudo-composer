import { project } from "../../../src/site-project/compiler/__tests__/fixtures";
import { createLocalSiteProjectStore } from "../store";

const testRoot = process.argv[2];
if (!testRoot) throw new Error("test root required");
const result = await createLocalSiteProjectStore({ testRoot }).apply({ project: project(), expectedRevision: null, expectedActive: null });
process.stdout.write(JSON.stringify(result));
