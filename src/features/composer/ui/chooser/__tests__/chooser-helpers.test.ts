import { describe, expect, it } from "vitest";
import { VIRTUAL_ROOT_SLOT_ID } from "../../../../../composer/browser";
import {
  assessPatternForestInsertion,
  describeInsertionTarget,
  eligibleEntries,
  matchesQuery,
} from "../chooser-helpers";
import { buildCatalogById, buildManifestIndex } from "../../tree/tree-helpers";
import {
  FIXTURE_IDS,
  fixtureCatalog,
  fixturePackManifest,
  fixtureDocument,
  fixtureNode,
  makeAbcDocument,
  resetFixtureIds,
} from "../../tree/__tests__/fixtures";

describe("eligibleEntries", () => {
  it("the virtual root accepts every catalog entry", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const manifest = buildManifestIndex(fixturePackManifest);
    const { entries, blockedReason } = eligibleEntries(document, manifest, fixtureCatalog, {
      parentId: null,
      slotId: VIRTUAL_ROOT_SLOT_ID,
      index: 1,
    });
    expect(blockedReason).toBeNull();
    expect(entries.map((e) => e.id).sort()).toEqual(
      fixtureCatalog.map((e) => e.id).sort(),
    );
  });

  it("filters by an accepts whitelist", () => {
    resetFixtureIds();
    const document = fixtureDocument([fixtureNode(FIXTURE_IDS.gallery, {}, { items: [] }, "gallery")]);
    const manifest = buildManifestIndex(fixturePackManifest);
    const { entries, blockedReason } = eligibleEntries(document, manifest, fixtureCatalog, {
      parentId: "gallery",
      slotId: "items",
      index: 0,
    });
    expect(blockedReason).toBeNull();
    expect(entries.map((e) => e.id)).toEqual([FIXTURE_IDS.box]);
  });

  it("blocks with a reason when a single-cardinality slot is already occupied", () => {
    resetFixtureIds();
    const document = makeAbcDocument(); // split.left already holds "A"
    const manifest = buildManifestIndex(fixturePackManifest);
    const { entries, blockedReason } = eligibleEntries(document, manifest, fixtureCatalog, {
      parentId: "split",
      slotId: "left",
      index: 1,
    });
    expect(entries).toEqual([]);
    expect(blockedReason).toMatch(/already has a component/i);
  });

  it("blocks adding into an opaque parent (e.g. a version mismatch) even though its slot is otherwise valid", () => {
    resetFixtureIds();
    const document = fixtureDocument([
      {
        id: "split",
        componentId: FIXTURE_IDS.split,
        componentVersion: 99, // manifest only knows version 1 -> opaque
        props: {},
        slots: { left: [], right: [] },
      },
    ]);
    const manifest = buildManifestIndex(fixturePackManifest);
    const { entries, blockedReason } = eligibleEntries(document, manifest, fixtureCatalog, {
      parentId: "split",
      slotId: "right",
      index: 0,
    });
    expect(entries).toEqual([]);
    expect(blockedReason).toMatch(/unavailable/i);
  });

  it("allows an unrestricted many-cardinality slot to accept everything", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const manifest = buildManifestIndex(fixturePackManifest);
    const { entries } = eligibleEntries(document, manifest, fixtureCatalog, {
      parentId: "split",
      slotId: "right",
      index: 2,
    });
    expect(entries.map((e) => e.id).sort()).toEqual(
      fixtureCatalog.map((e) => e.id).sort(),
    );
  });
});

describe("matchesQuery", () => {
  it("matches title/category/description case-insensitively", () => {
    const box = fixtureCatalog.find((e) => e.id === FIXTURE_IDS.box)!;
    expect(matchesQuery(box, "BOX")).toBe(true);
    expect(matchesQuery(box, "content")).toBe(true);
    expect(matchesQuery(box, "generic")).toBe(true);
    expect(matchesQuery(box, "nope")).toBe(false);
  });

  it("an empty query matches everything", () => {
    const box = fixtureCatalog.find((e) => e.id === FIXTURE_IDS.box)!;
    expect(matchesQuery(box, "   ")).toBe(true);
  });
});

describe("assessPatternForestInsertion", () => {
  it("checks the whole forest against slot acceptance and cardinality before submit", () => {
    resetFixtureIds();
    const document = fixtureDocument([fixtureNode(FIXTURE_IDS.gallery, {}, { items: [] }, "gallery")]);
    const manifest = buildManifestIndex(fixturePackManifest);
    const roots = [
      fixtureNode(FIXTURE_IDS.box, {}, {}, "pattern-box"),
      fixtureNode(FIXTURE_IDS.text, {}, {}, "pattern-text"),
    ];

    const result = assessPatternForestInsertion(
      document,
      manifest,
      { parentId: "gallery", slotId: "items", index: 0 },
      roots,
    );
    expect(result).toMatchObject({ eligible: false, reason: expect.stringMatching(/does not accept/i) });
  });

  it("honors a resolved bound-root policy and never changes either input during its dry run", () => {
    resetFixtureIds();
    const document = fixtureDocument([]);
    document.binding = { sourceRecordId: "template", outletId: "main" };
    const sourceRoots = [fixtureNode(FIXTURE_IDS.box, {}, {}, "pattern-box")];
    const beforeDocument = structuredClone(document);
    const beforeRoots = structuredClone(sourceRoots);
    const manifest = buildManifestIndex(fixturePackManifest);

    expect(
      assessPatternForestInsertion(
        document,
        manifest,
        { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 },
        sourceRoots,
        { kind: "unresolved" },
      ),
    ).toMatchObject({ eligible: false, reason: expect.stringMatching(/until its Global template outlet is resolved/i) });
    expect(document).toEqual(beforeDocument);
    expect(sourceRoots).toEqual(beforeRoots);
  });
});

describe("describeInsertionTarget", () => {
  it("describes the virtual root", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const manifest = buildManifestIndex(fixturePackManifest);
    const catalogById = buildCatalogById(fixtureCatalog);
    expect(
      describeInsertionTarget(document, manifest, catalogById, {
        parentId: null,
        slotId: VIRTUAL_ROOT_SLOT_ID,
        index: 0,
      }),
    ).toBe("Document root");
  });

  it("describes a real parent/slot as 'Title › Slot label'", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const manifest = buildManifestIndex(fixturePackManifest);
    const catalogById = buildCatalogById(fixtureCatalog);
    expect(
      describeInsertionTarget(document, manifest, catalogById, { parentId: "split", slotId: "right", index: 2 }),
    ).toBe("Split Layout › Right");
  });
});
