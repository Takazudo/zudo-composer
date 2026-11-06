# zudo-composer documentation — authoring policy

This file is the single editorial policy for the `doc/` developer documentation site. `doc/CLAUDE.md` points here, and so does the `zudo-doc-writing` skill. Keep category rules in this file only — do not copy them into other files.

## How to read this file

- **[decision]** — decided by the project owners.
- **[fact]** — stated in existing documentation or configuration.
- **[hypothesis]** — an author's or AI agent's inference that the owners have not confirmed. It is not a rule yet.
- **TBD** — undecided. Do not guess a value for it; ask the owners or leave it TBD.

## Readers and purpose

- Primary readers: developers working on or integrating `zudo-composer` [fact: `doc/CLAUDE.md` describes this as the English developer documentation site]
- What the documentation helps them do: TBD

## Scope

- In scope: the tool's architecture, host setup, worked guides, and the repository's development workflow [fact: the five category introductions]
- Out of scope: operator reference, which stays in the repository's `docs/` directory [fact: `doc/CLAUDE.md`]

## Entry points and reading order

- Entry points: the home page and `/docs/overview/`, the first header navigation item [fact: `headerNav` in `zfb.config.ts`]
- Recommended reading order: TBD

## Categories

A directory under `src/content/docs/` is a category; its `index.mdx` is the landing page. The header navigation lists them in this order [fact: `headerNav` in `zfb.config.ts`].

| Category | Contains | Does not contain | Boundary with neighbours |
|----------|----------|------------------|--------------------------|
| `overview/` | Purpose, boundaries and vocabulary of zudo-composer, plus a repository map [fact: category introduction] | TBD | TBD |
| `architecture/` | Boundaries and data flow: product domains, host integration, preview protocol and the static-site pipeline [fact: category introduction] | TBD | TBD |
| `setup/` | Installing into a host project, configuration, CMS data, assets, routes, and the command-line and runtime surfaces [fact: category introduction] | TBD | TBD |
| `guides/` | Task-oriented walkthroughs that build on the architecture and setup reference [fact: category introduction] | TBD | TBD |
| `development/` | Developing, validating and shipping zudo-composer and this site: local workflow, gates, browser lanes and handoffs [fact: category introduction] | TBD | TBD |

Important exceptions (pages kept outside their natural category, and why): none recorded.

## Constraints

- **URLs**: a page's URL follows its file path, so moving a file changes its URL [fact]. Published URLs that must not change: TBD
- **Translation**: single locale `en` in `src/content/docs/` [fact].
- **Generated content**: pages with `generated: true` are generator-owned; change their source or settings, not the files [fact].

## Adding or changing content

1. **Typo, wording, or formatting fix only** → follow the normal writing rules in `doc/CLAUDE.md` and stop here.
2. **Adding a page, a new reader task or topic, or changing a page's role** → answer four questions:
   1. Who can do what with this content?
   2. Does an existing page already serve that role? (Search titles, descriptions, and category listings.)
   3. Why this category, and is there a competing destination? (Use the boundaries above.)
   4. Does this addition change what the category means?
3. **Answers are clear** → place the content and report the placement reason in one line. Do not record routine placements here.
4. **Evidence of a category conflict, duplication, a new independent cluster of reader tasks, or a findability problem** → structure review:
   - Write the concrete reader problem first.
   - Read the category map (the directory tree) and this file, then only the related, competing, or exception pages. Say which part you surveyed; never call a partial survey a full audit.
   - Compare: add to an existing page, improve while keeping the structure, a local reorganization (split/merge pages, rename/split/merge one category), or related links / an index page.
   - Keep only the options that solve the reader problem, then prefer the smaller change among them. Keeping the structure is a valid outcome. Do not decide by page count or category balance.
5. **Important goals conflict and this file does not resolve it** (for example, a fixed URL versus the right category) → ask the owners, with the concrete options and what each affects. Otherwise do not ask.

## Maintaining this policy

- Record category meaning, important exceptions, and the reasons for reorganizations that actually happened. Label each entry [decision], [fact], or [hypothesis].
- Do not turn a [hypothesis] into a rule until the owners confirm it, and do not reorganize the same category again without new evidence.
- When you move a category or this file, update the references in `doc/CLAUDE.md` and `.claude/skills/zudo-doc-writing/SKILL.md` in the same change.
- Updating `@takazudo/zudo-doc` never changes this file; it is yours to maintain.

Worked examples and the reasoning behind this procedure: https://github.com/zudolab/zudo-doc/blob/main/src/content/docs/guides/maintaining-documentation-structure.mdx (optional; everything needed for the procedure is above).
