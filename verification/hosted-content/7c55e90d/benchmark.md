# Hosted session state measurements

Before: `8359b6d5ad0c349df2ea265741324534840009c5`; after/package-output B: `7c55e90da4ce0a1e513b84d418110436234c877d`.
Node v24.19.0, Linux x64, pnpm 11.5.2. Five samples; median milliseconds per operation. Raw samples are retained beside this file. These final runs ran after local heavy work finished; the observable read accumulator is equal before and after (1,387,500). These observations are not timing thresholds.

| Entries | JSON bytes | Cold before → after | Warm with reviewed snapshot before → after | Edit with checkpoint before → after |
| --- | ---: | ---: | ---: | ---: |
| 10 | 12,905 | 0.070638 → 0.039078 | 0.116814 → 0.000413 | 0.114441 → 0.085634 |
| 100 | 125,045 | 0.478233 → 0.248040 | 0.918518 → 0.000138 | 0.730426 → 0.499574 |
| 1,000 | 1,247,345 | 6.103867 → 3.277269 | 12.230076 → 0.000180 | 8.842630 → 5.977564 |

Cold: 30 first getters after detached recovery construction, construction excluded. Warm: 200 unchanged getters after 20 warmups, consuming each projected entry count into the printed `observed` accumulator, with a reviewed snapshot containing the full provider payload. Editing: 40 distinct field edits, including emission/projection and a full recovery checkpoint copy, awaiting the no-op host writer each time. No transport save or durable I/O is timed. Sub-microsecond warm results and small-content editing are noisy; deterministic reference, freeze and correctness assertions supply CI acceptance. Editing still scales with content size; 

Repeat from the repository root:

```sh
git show 8359b6d5ad0c349df2ea265741324534840009c5:src/hosted-content/session.ts > /tmp/session-before.ts
corepack pnpm exec tsx scripts/benchmark-hosted-session.ts /tmp/session-before.ts
corepack pnpm exec tsx scripts/benchmark-hosted-session.ts
```

The temporary baseline module imports only types, so it needs no copied source dependencies. The committed benchmark uses the repository's own content constructors and the selected session implementation. It does not invoke application/deployment workflows.
