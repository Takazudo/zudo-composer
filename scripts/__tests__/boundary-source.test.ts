import { describe, expect, it } from 'vitest';
import { boundarySource } from '../boundary-source.mjs';

const forbiddenSymbol = /\b(?:window|localStorage|adapter|legacy)\b/;

describe('boundary source filtering', () => {
  it('removes JSDoc prose and tags while retaining the documented code', () => {
    for (const comment of ['/** window adapter legacy */', '/** @deprecated window adapter legacy */']) {
      const filtered = boundarySource(`${comment}\nexport const value = 1;`, { strings: false });
      expect(forbiddenSymbol.test(filtered)).toBe(false);
      expect(filtered).toContain('export const value = 1;');
    }
  });

  it('removes line and block comments without joining identifiers', () => {
    const source = '// window adapter legacy\nconst local/* localStorage */Storage = 1;';
    const filtered = boundarySource(source);
    expect(forbiddenSymbol.test(filtered)).toBe(false);
    expect(filtered.length).toBe(source.length);
    expect(filtered.split('\n')).toHaveLength(2);
  });

  it('keeps dependency paths and comment-like text inside literals', () => {
    const source = 'import { value } from "./error-adapter"; const url = "https://example.com"; const regex = /https?:\\/\\//; window;';
    const filtered = boundarySource(source);
    expect(filtered).toBe(source);
    expect(boundarySource(source, { strings: false })).not.toContain('adapter');
    expect(forbiddenSymbol.test(boundarySource(source, { strings: false }))).toBe(true);
  });

  it('ignores quoted prose but preserves executable template expressions', () => {
    const source = 'const text = `window ${localStorage.getItem("legacy")} adapter ${`legacy ${window.name}`}`;';
    const filtered = boundarySource(source, { strings: false });
    expect(filtered).toContain('localStorage.getItem(');
    expect(filtered).toContain('window.name');
    expect(filtered).not.toContain('legacy');
    expect(filtered).not.toContain('adapter');
  });

  it('handles escaped quotes, regex comment lookalikes, and trailing comments', () => {
    const source = String.raw`const text = "quote\" // window"; const regex = /[/*]/; /* legacy */ window; // adapter`;
    const filtered = boundarySource(source, { strings: false });
    expect(filtered).toContain('/[/*]/');
    expect(filtered).toContain('window;');
    expect(filtered).not.toContain('legacy');
    expect(filtered).not.toContain('adapter');
  });

  it('handles JSX prose separately from executable expressions', () => {
    const filtered = boundarySource('const view = <div title="legacy">adapter {window.name}</div>;', { strings: false });
    expect(filtered).not.toContain('legacy');
    expect(filtered).not.toContain('adapter');
    expect(filtered).toContain('window.name');
  });

  it('retains package dependencies in JSON', () => {
    expect(boundarySource('{ "dependencies": { "@takazudo/zfb": "1" } }', { fileName: 'package.json' }))
      .toContain('"@takazudo/zfb"');
  });

  it('handles CSS comments without treating unquoted URLs as line comments', () => {
    const source = '/* legacy */ .x { background: url(https://example.com); content: "/* adapter */"; }';
    const filtered = boundarySource(source, { fileName: 'style.css' });
    expect(filtered).not.toContain('legacy');
    expect(filtered).toContain('https://example.com');
    expect(filtered).toContain('/* adapter */');
    expect(boundarySource(source, { fileName: 'style.css', strings: false })).not.toContain('adapter');
  });

  it('retains computed API access and compatibility discriminants', () => {
    const source = `globalThis['localStorage']; type State = 'ready-with-recovery'; if (state === 'legacy') {} switch (state) { case 'adapter': break; }`;
    const filtered = boundarySource(source, { strings: false });
    expect(filtered).toContain("'localStorage'");
    expect(filtered).toContain("'ready-with-recovery'");
    expect(filtered).toContain("'legacy'");
    expect(filtered).toContain("'adapter'");
  });

  it('keeps real violations after comments and strings', () => {
    const source = '// allowed window\nconst text = "adapter"; /* legacy */ localStorage.clear(); const legacy = true;';
    const filtered = boundarySource(source, { strings: false });
    expect(filtered).toContain('localStorage.clear()');
    expect(filtered).toContain('const legacy = true');
  });
});
