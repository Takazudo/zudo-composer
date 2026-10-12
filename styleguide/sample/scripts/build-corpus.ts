import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateStoryDescriptors, slugify } from "@takazudo/zudo-sg/registry";
import ts from "typescript";
import type { Story, StoryMeta } from "../preview/story-types";

const root = process.cwd();
const files = (await readdir(resolve(root, "stories"), { recursive: true }))
  .filter((path) => path.endsWith(".stories.tsx"))
  .sort();
if (files.length !== 12) {
  throw Error(`Expected 12 actual story files, got ${files.length}`);
}
const descriptors = [];
const sourceBySlug: Record<string, unknown> = {};
const loaders: string[] = [];
let count = 0;
let bareCount = 0;
let genericCount = 0;

for (const file of files) {
  const mod = await import(pathToFileURL(resolve(root, "stories", file)).href);
  const meta = mod.default as StoryMeta;
  if (typeof meta.usage !== "string")
    throw Error(`Invalid usage source in ${file}`);
  const slug = slugify(meta.title);
  const source = ts.createSourceFile(
    file,
    await readFile(resolve(root, "stories", file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const exportNames: string[] = [];
  for (const node of source.statements) {
    if (
      !ts.isVariableStatement(node) ||
      !node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      continue;
    }
    for (const declaration of node.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !declaration.type ||
        !ts.isTypeReferenceNode(declaration.type) ||
        declaration.type.typeName.getText(source) !== "Story"
      ) {
        throw Error(`Unexpected exported declaration in ${file}`);
      }
      exportNames.push(declaration.name.text);
      if (declaration.type.typeArguments?.length) genericCount++;
      else bareCount++;
    }
  }
  if (
    Object.keys(mod).filter((key) => key !== "default").length !==
    exportNames.length
  ) {
    throw Error(`Runtime/source export mismatch in ${file}`);
  }
  const variants = exportNames.map((exportName) => {
    const story = mod[exportName] as Story;
    if (
      !story ||
      typeof story.render !== "function" ||
      typeof story.name !== "string"
    ) {
      throw Error(`Invalid story ${file}:${exportName}`);
    }
    if (story.source !== undefined && typeof story.source !== "string") {
      throw Error(`Invalid variant source ${file}:${exportName}`);
    }
    count++;
    return {
      exportName,
      name: story.name,
      ...(story.controls ? { controls: story.controls } : {}),
    };
  });
  descriptors.push({
    id: file,
    slug,
    title: meta.title,
    category: meta.category,
    description: meta.description,
    sourcePath: `stories/${file}`,
    ...(meta.order === undefined ? {} : { order: meta.order }),
    variants,
    thumbnail: {
      kind: "image",
      src: `/sample-thumbnails/${slug}.png`,
      width: 800,
      height: 480,
      alt: `${meta.title} rendered preview`,
    },
  });
  sourceBySlug[slug] = variants.map((variant) => ({
    exportName: variant.exportName,
    name: variant.name,
    source: mod[variant.exportName].source ?? meta.usage,
  }));
  loaders.push(
    `${JSON.stringify(slug)}: () => import(${JSON.stringify(`../stories/${file}`)})`,
  );
}
if (bareCount !== 66 || genericCount !== 5) {
  throw Error(
    `Typed story inventory changed: ${bareCount} bare, ${genericCount} generic`,
  );
}
if (count !== 71) {
  throw Error(
    `Expected all 71 actual story exports (66 bare + 5 generic), got ${count}`,
  );
}
const validated = validateStoryDescriptors(descriptors);
// Reject accidental functions/signals/VNodes rather than silently dropping them.
JSON.stringify({ validated, sourceBySlug }, (_key, value) => {
  if (
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw Error("Non-serializable corpus value");
  }
  return value;
});
await mkdir("src/styleguide", { recursive: true });
await writeFile(
  "src/styleguide/descriptors.ts",
  `// Generated from the actual Preact story corpus.
import type { StoryDescriptor } from "@takazudo/zudo-sg/registry";
export const storyDescriptors = ${JSON.stringify(validated, null, 2)} satisfies StoryDescriptor[];
`,
);
await writeFile(
  "src/styleguide/sources.ts",
  `// Generated Story.source ?? meta.usage.
import type { CodePanelVariant } from "@takazudo/zudo-sg/code-panel";
export const sourceBySlug: Record<string, CodePanelVariant[]> = ${JSON.stringify(sourceBySlug, null, 2)};
`,
);
await writeFile(
  "preview/loaders.ts",
  `// Generated identity map; only the Preact pipeline imports story modules.
export const loaders = {${loaders.join(",\n")}};
`,
);
console.log(
  `Validated actual corpus: ${files.length} files, ${count} variants.`,
);
