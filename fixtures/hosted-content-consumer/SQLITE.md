# Durable adapter proof

This fixture is outside the tool's pnpm workspace. It uses only the installed
`zudo-composer/hosted-content` and `zudo-composer/hosted-content/testing` public
entries. Node **24** is required here for `node:sqlite`; this fixture does not
change the tool's supported Node versions or add SQLite to a browser or Worker
bundle. The external installation runner supplies the exact package dependency
and preserves the standalone lockfile.

Run in the independently installed fixture:

```sh
node durable-proof.mjs
```

The report identifies three different proofs:

- The shipped framework-independent runner against the deterministic memory
  fake, which forces faults and interleavings but demonstrates no disk or
  process durability.
- The same runner against independent SQLite connections to an actual file,
  including close/reopen, receipt recovery, coherent capture, and both
  existing-entry and newly-created-entry two-publication traces.
- Separate child processes, each with its own SQLite connection. These race
  CAS writes, duplicate creation and snapshot capture; inject a real receipt
  SQL constraint failure; kill a process after head and receipt writes
  before commit; replace a process after a lost creation acknowledgement;
  and complete two integrations while preserving newer created-entry edits.

These are SQLite and fake results. Pinsel must run the same public runner
against its actual D1 adapter; this fixture makes no D1 verification claim.

## SQLite transaction boundary

`initializeSqliteDatabase(filename, seed)` seeds only an absent database.
`openSqliteHandle(filename)` opens a new connection. A handle supports one
in-flight operation; callers open separate handles for concurrency. The HTTP
test transport opens a separate connection for every request.

The service never holds a transaction across host code. It reads the head
row and keyed receipt/snapshot/publication rows, prepares the change, then calls
`commit`. Each commit is one short `BEGIN IMMEDIATE` transaction that runs the
same static statement list a host would send as one D1 `batch()`: a head
`UPDATE … WHERE version = ?`, a guard insert that aborts when that update did
not apply, insert-only receipt and snapshot rows, and a publication upsert.
A constraint failure rolls everything back and resolves `false`; the service
then retries from fresh reads, where it finds the newer revision or the
committed receipt. Other failures roll back and reach the caller. Commits use
WAL and `synchronous=FULL`. Returned/read values are detached.

The head row holds only the working state, baseline providers and the active
publication ID, so its size does not grow with history. Each receipt, snapshot
and publication is its own keyed row.

Busy acquisition retries are bounded to eight seconds by default, with capped
backoff. The backend does not prune receipts or recycle keys. No shared
JavaScript lock supplies cross-process correctness.

`createSqliteConformanceFactory()` supplies the public runner's independent
handles, fault injection, commit gates and restart hooks. The process proof
additionally pauses **after** the batch statements, inside the open
transaction, to test actual process-crash rollback before `COMMIT`.

## Local HTTP checkpoint

`startHostedFixtureServer({ filename, port, fixture })` provides local-only
`/api/state`, `/api/policy`, `/api/fixture`, `/api/execute`,
`/api/receipt?key=`, and `/api/publication?id=` endpoints. It binds loopback
and uses a fixed fixture actor; production authentication belongs to the host.
`fixture` may contain `database`, `policy`, `project`,
`validateSubmission`, `validateMarkdown`, and `presentation`.
The browser checkpoint closes and recreates this backend, then opens an
independent browser context against the same SQLite file.

The storage module, HTTP server and process runner are fixture code. They
must never enter the tool's portable, browser/editor or testing runtime graph.

## Local publication provider

```sh
node publication-proof.mjs --directory work/publication-state --artifacts work/publication-artifacts
```

`publication-proof.mjs` implements a host-owned provider and a separate local
export sink. The sink has one fixed destination. Its independently persisted
`remote.json` baseline, definition, immutable candidate and operation facts are
serialized with a filesystem lock and written with atomic rename and fsync.
These are synthetic remote facts and commit identities, never live Git/API
operations or evidence of deployment. Submission fields cannot supply a
destination or path.

The provider reads complete immutable snapshots directly from its trusted
SQLite adapter, rather than reusing a scoped browser DTO. Integration checks
the sink's own exact baseline and definition. The proof persists remote
integration A, discards and reopens database and sink handles before database
reconciliation, then confirms that newer draft B survives and a second
publication delivers B. Both an existing Entry and a newly created Entry run
the full trace. Exact retries and late A facts cannot overwrite B2.

Failure, unavailable lookup, stale polling, recovered authoritative status,
disabled configuration, forbidden destination input, and an external remote
baseline update have explicit retained-draft assertions. Availability changes
advance a local status sequence while the remote sequence rejects older
observations. No provider result is labeled deployed.

The optional artifact directory contains raw `existing-entry-A/B.snapshot.json`
and `new-entry-A/B.snapshot.json` delivery candidates plus
`publication-evidence.json`. The renderer can consume those exact candidates
without recapturing newer draft data. Retained local state is placed beneath a
fresh scenario directory; a run never overwrites an earlier database.
