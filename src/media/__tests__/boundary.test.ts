import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? sourceFiles(path.join(root, entry.name))
    : /\.(ts|tsx)$/.test(entry.name) ? [path.join(root, entry.name)] : []);
}

describe("Media headless boundary", () => {
  it("does not import UI, DOM providers, or feature/application modules", () => {
    const root = path.resolve(process.cwd(), "src/media");
    const production = sourceFiles(root).filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`));
    for (const file of production) {
      const source = fs.readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\bpreact\b|localStorage|from\s+["'][^"']*(?:features|app\/|components)[^"']*["']|external CMS/i);
    }
  });
});
