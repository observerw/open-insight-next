# Bootstrap: Implement First, Design Later

Use this reference when a module is new or its public failure behavior is still being discovered. There is nothing to classify yet, so the evidence gate in `SKILL.md` waits.

## Phase 1: one placeholder, keep implementing

Declare one public error for the module:

```ts
export class FooError extends Schema.TaggedError<FooError>("open-insight/FooError")("FooError", {
  cause: Schema.Defect(),
}) {}
```

- `cause` is the only field. No `reason`, `operation`, `retryable`, `message`, wrapper, or union: the failure semantics are not known yet, so nothing can be named or typed.
- Name the class after the module, not after an expected failure. It is scaffolding, not a contract; Phase 2 may rename or replace it.
- No encoder/decoder, migration path, or compatibility test. The placeholder is a runtime channel. `Schema.Defect` is the only schema API needed here (`node_modules/effect/src/Schema.ts:8732`); skip `design.md` and `schema.md` until Phase 2.

At every expected failure site:

```ts
if (Option.isNone(end)) {
  return yield* new FooError({ cause: new Error("session stream is missing its end event") });
}
```

- Wrap expected dependency and native failures into `FooError` at the module boundary, keeping the native value as `cause`. The public channel stays one shape, and Phase 2 has a single set of sites to reclassify instead of a union of foreign errors.
- Write the `new Error()` text as a short domain condition — the operation and what was violated. It is a seed for Phase 2, not a diagnostic: no stack descriptions, restated exception names, or user-facing copy.
- Do not add a second error class, a constructor helper, or a `reason` field for cases you can already imagine. Guessed reasons are exactly what Phase 2 is meant to fix.
- Only expected failures use the placeholder. Broken invariants and impossible states stay defects, and caller cancellation stays interruption; never funnel everything into the channel with a broad `catchAll`, and do not use `Effect.die` for expected failures either.

## Phase 2: design the real error model

Tell the user the design pass is due when the module shows any of these signals; do not start it silently.

- the public operations and their expected failure outcomes have stopped changing;
- one class now covers failures that callers would act on differently — retry, ask for input, stop, report a user-facing error;
- consumers begin matching on the channel, or the error is about to be persisted, transmitted, or exposed as an API;
- the module is being handed off, published, or reviewed as finished.

Then run the normal process from `SKILL.md`, using the placeholder sites as the evidence inventory:

1. Inventory every placeholder construction and every `new Error(` seed in the module. Each evidence-table row now has a real observed failure and a real call site.
2. Group by business semantics, not by message text: the same caller action, retry/safety policy, user or API meaning, and required fields belong to one reason. Two different `new Error()` texts are not two reasons.
3. Choose the smallest shape from `SKILL.md` step 3 — one error, a flat union, or a wrapper with nested reasons — and add a field only where a demonstrated consumer, diagnostic, or wire contract needs it.
4. Replace the seeds and delete the placeholder. A surviving `new Error()` means its semantics were never classified; a surviving placeholder means the pass is unfinished. Keep the class only if it becomes a deliberate bounded "unclassified" reason with a real caller action.
5. Finish with the validation and test requirements of the completion contract, and report the mapping from seed to reason, including seeds that were merged or dropped.

The placeholder's `cause` is deliberately unstructured, so it is not evidence for a native `cause` field in the designed error. Decide causes again in Phase 2 from the boundary (`references/schema.md`).
