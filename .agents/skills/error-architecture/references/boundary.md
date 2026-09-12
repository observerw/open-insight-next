# Boundary, Evolution, and Validation

Use this reference when classifying native/provider failures, preserving interruption and defects, handling uncertain side effects, evolving a public contract, or finishing validation.

## Classify at one boundary

Translate expected native failures at the adapter or module boundary, where operation context and response direction are available. First identify the actual signals in the target module; the sequence below is a classification strategy, not a required taxonomy.

1. Preserve Effect interruption/cancellation and programmer defects unless the module contract explicitly says otherwise.
2. Normalize observed local caller-input failures into an input reason before invoking a dependency.
3. Determine whether a response was received and whether dispatch occurred when those facts affect caller action. Classify transport and timeout uncertainty before inspecting status codes.
4. Parse responses with a bounded schema. Map parse failures to a decode reason only when callers need that distinction; map parsed contract violations to a protocol/output reason only when the contract exposes it.
5. Map valid external/domain responses to stable reasons only when the boundary can distinguish them and callers act on them.
6. Map expected but unclassified external failures to a bounded generic reason only when the module has a real public boundary and callers need a stable fallback. Do not add `UnknownError` to fill an unobserved branch.

Conceptually, a classifier has three outcomes:

```ts
type Classification =
  | { readonly kind: "reason"; readonly reason: ModuleErrorReason }
  | { readonly kind: "defect"; readonly cause: unknown }
  | { readonly kind: "interrupt" };
```

This is a reasoning aid, not a required exported abstraction. The implementation may use Effect APIs, but it must preserve the distinction. Document which evidence wins when signals conflict, for example a bounded external code over a generic transport status.

Expected environmental failures should become a semantic public reason plus diagnostics only when the module actually promises that boundary. Do not expose them only as an opaque cause. Conversely, do not catch every thrown value and turn defects or interruption into retryable public errors.

## Counterexample gate

For every accepted public reason, specify at least one relevant non-match or preservation case. The counterexample must come from the actual boundary, not from an invented taxonomy. At minimum, test these when the module can encounter them:

- caller cancellation remains interruption and is not mapped to a public reason;
- programmer defects remain defects and are not mapped merely because a broad `catch` sees `unknown`;
- malformed response data is not silently treated as a valid domain rejection, and parsed contract violation is not called a decode failure without evidence;
- timeout before and after dispatch do not receive the same retry semantics unless the boundary proves that they do;
- the same native exception is not assigned one public reason when the surrounding evidence can produce different domain meanings.

If a listed condition cannot occur in the target module, mark it not applicable. Do not add a reason just to create a test case.

## Dispatch and retry

A timeout before dispatch can be grouped with a connection failure only when the boundary knows no side effect could start. A timeout after dispatch means completion is unknown. For mutations, reconcile before retrying unless the operation is idempotent or has a stable idempotency key. Preserve operation and request context on the wrapper or service policy when retry safety depends on more than the reason alone, and only if those fields have evidence-backed consumers.

## Implement and evolve together

For a new or changed operation:

- inventory observed semantic outcomes, caller action, required fields, dispatch certainty, and sensitive data;
- compare outcomes with existing reasons before adding a tag;
- define stable identifiers, tags, fields, and a named union only where the evidence supports them;
- update public error-channel types and exports, respecting generated barrels;
- add boundary constructors/classifiers and preserve defects/interruption;
- update callers with deliberate `catchTag`, `catchReason`, or `unwrapReason` handling;
- add construction, classification, handling, and schema-boundary tests required by the actual changed surface;
- run the narrowest relevant checks and report any unavailable validation.

A new operation is incomplete if an expected native error can still escape the public boundary. A design is also incomplete if it claims a reason, field, or compatibility rule without source evidence.

## Compatibility checklist

When an error is serialized, persisted, or transmitted, treat its schema as a compatibility contract:

- never rename or reuse a tag for a new meaning;
- add reason variants additively and update the union, classifier, handlers, and tests together;
- make a new field optional only when old producers can legitimately omit it and consumers have a safe fallback;
- support old representations during an explicit migration when a field meaning or shape must change;
- retain old tags as aliases only with documented behavior; do not silently emit competing tags;
- when splitting a reason, preserve old decoding/handling before removing it as a deliberate breaking change.

When no serialization, persistence, or transport boundary exists, compatibility payload tests are not applicable and should not be invented.

## Focused test matrix

Scale tests to the changed surface:

- construction: tags, required fields, computed `message`, policy data, and wrapper delegation only when those are part of the evidence-backed contract;
- classifier: each observed precedence branch, status/code collision, malformed body, unknown code, credential failure, and dispatch uncertainty that the module can actually encounter;
- handling: each `catchTag`/`catchReason` branch and unmatched-reason behavior;
- safety: runtime cause preservation where intended and exclusion/redaction of secrets, full payloads, unbounded text, and native objects;
- schema boundary: `Schema.encode`/`Schema.decode`, invalid data, required fields, and `optional` versus `optionalKey` only when a schema boundary exists;
- compatibility: representative old payloads and every new union member when persisted or transmitted;
- types: intended Effect error-channel narrowing and reason-field access.

Every test row should point back to an observed module scenario. A missing scenario is a reason to omit the test, not to invent a public error category.
