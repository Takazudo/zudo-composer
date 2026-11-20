# Bounded Content field assistance

A host can explicitly allow Content-AI to propose text for particular model field
IDs. The policy is trusted server configuration, independent of the chosen model
provider; model output cannot expand it.

```ts
assistant: {
  provider: 'codex-cli',
  model: 'your-explicit-model',
  effort: 'high',
  contentFields: [
    { providerId: 'content-filesystem', modelId: 'course', fieldIds: ['course-price'] },
    { providerId: 'content-filesystem', modelId: 'faq-item', fieldIds: ['faq-item-question', 'faq-item-answer'] },
    { providerId: 'content-filesystem', modelId: 'note', fieldIds: ['note-title', 'note-body'] },
  ],
}
```

Use the actual provider, model and field IDs of the host's Content schema. Keys
and labels are not identities. Only existing text, long-text and Markdown fields
that the owning editorial boundary accepts can be proposed. Prices stay display
text; this does not authorize numeric conversion, publication, arbitrary patches
or editing similarly worded records. An FAQ excerpt and detailed FAQ remain
separate owners and require separate policy entries if both should be supported.

Omitting `contentFields` retains the existing standalone Content-AI title/body
behavior. An explicit empty array denies all Content fields. The host-document
Assistant requires explicit ownership capabilities for its shared-field routing;
standalone defaults are not proof of rendered owner resolution. Unknown keys,
duplicate model policies/field IDs and oversized policy arrays are rejected.
Field existence, kind and editability are checked against the current schema when
used. Unlisted models have no permission under an explicit policy.

The configured provider remains unchanged. The ordinary Content-AI request calls
that provider once and strictly parses only the offered field keys. Existing
Article title/body proposals keep their tool shape; other field sets use a nested
`values` object so a Content field named `summary` cannot collide with proposal
metadata. Multiple actions, extra fields and malformed values are refused.

The integrated Assistant may instead stage the model's already-returned values
through an internal trusted staging adapter. This performs the same owner policy,
expected-revision, field validation and immutable proposal persistence, without a
second model call. It is not exposed as a Content browser wire operation. Its
preparation key is scoped to backend and actor; replay recovers the same proposal,
while changed payload reuse refuses. Cancellation before persistence writes no
proposal; cancellation during storage can leave a private recoverable proposal,
never a canonical Content edit.

Apply rechecks the current field policy and delegates to the same keyed Content
save used by human editing, retaining history and receipts. Removing permission
blocks a fresh Apply. Recovering an already committed Apply does not require the
provider or old policy to remain available. Undo retains the existing guard against
later human edits and restores only through the owning editorial boundary. The
host-reviewed Assistant additionally validates its exact workspace/render review;
entry policy and Content revision checks alone do not establish that review.

Tests: `server/config/__tests__/content-fields.test.ts`,
`server/content-editorial/__tests__/ai-policy.test.ts`, and
`server/content-ai/__tests__/model-proposer.test.ts`; existing native/hosted
editorial equivalence tests retain the Article behavior. Scripted or fake provider
tests prove deterministic integration, not authenticated inference.

The internal stager also supports lookup-only `recover(request, guard)`. It uses the same preparation key, owner, actor and payload fingerprint to recover an immutable proposal after a review-envelope response loss, even when current Content has changed. It never runs inference, validates against current Content or writes. The caller retains the active run/cancellation fence; recovery does not authorize Apply, which still requires review and current preconditions (or an already committed receipt).
