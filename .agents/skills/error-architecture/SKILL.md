---
name: error-architecture
description: Design or review a public Effect error model, including Schema.TaggedError or Schema.Error classes, reason unions, boundary classification, serialization, and compatibility changes.
---

# Effect Error Architecture

Use this skill when a module's public Effect error channel is being designed, reviewed, or changed. Produce an implementable result: stable tags or schema identity, only evidence-backed fields and reasons, constructors/classifiers, handling guidance, and focused tests. Do not give generic advice about error handling.

## Non-negotiable evidence gate

Do not design the error model from this skill's examples or taxonomy. They are vocabulary and API demonstrations, not a template.

Before proposing a public tag, reason, field, wrapper, cause, retry policy, or compatibility rule, inspect the target module's actual error definitions, construction/classification sites, consumers, boundary signals, and nearby tests. Record the result in an evidence table:

| Candidate | Module source (path:line) | Observed failure or existing contract | Consumer/boundary action | Why the candidate is needed | Sensitive/bounded? |
| --------- | ------------------------- | ------------------------------------- | ------------------------ | --------------------------- | ------------------ |

Hard rules:

- Every accepted public field and reason must have a row with a concrete module-local source location and a demonstrated caller, diagnostic, telemetry, user-message, or wire-compatibility purpose.
- A reference example, taxonomy name, helper name, dependency exception name, HTTP status, or the fact that a dependency _could_ fail is not evidence by itself.
- If a field or reason has no evidence, put it in a rejected-candidates table and do not include it in the proposed public shape. Do not fill missing evidence with `message`, `cause`, `operation`, `UnknownError`, `ConnectionError`, `TimeoutError`, `requestId`, or a reason union.
- If the module implementation, consumers, and boundary contract are unavailable, stop at an evidence request. Do not invent a complete error model.
- Do not infer a public reason from an internal phase. Malformed bytes, parsing, transport, and provider exception names become separate public reasons only when callers have different semantic actions or the existing contract requires that distinction.
- Do not add a wrapper or `reason` union for visual consistency. One observed public failure normally uses one error class; an empty field shape is valid.

## Route the work

1. Inspect only the target module's current error channel, construction/classification sites, consumers, and nearby tests that affect the task. Preserve unrelated user changes. Start with an evidence inventory and explicitly list relevant failures that are _not_ observed.
2. State the module promise and caller actions in domain language. Group outcomes only when the evidence shows the same handling, retry/safety policy, user/API meaning, and required fields.
3. Choose the least powerful public shape supported by evidence:
   - one semantic failure: one `Schema.TaggedError` when tagged matching is part of the contract, or `Schema.Error` when a discriminator is not needed;
   - several independent errors with no shared context: a flat union of tagged errors;
   - a tagged wrapper with `reason` only when multiple observed reasons need one error channel or shared stable module context and callers need to match the nested reasons.
4. Load `references/design.md` for semantic grouping and field decisions.
5. Load `references/schema.md` when defining or changing `Schema.Error`, `Schema.TaggedError`, reason schemas, causes, encoding, field types, or Effect error handlers. Read the corresponding files under `node_modules/effect/src` for this repository's installed version; never rely on memory. The result must include a source landing (file path, line range, and relevant excerpt) for each Effect API used.
6. Load `references/boundary.md` when translating native/provider failures, handling timeout or dispatch uncertainty, evolving an existing contract, or planning validation. Preserve interruption and defects rather than classifying every thrown value as a public reason.
7. For every accepted candidate, write a short rejection check: which nearby tempting field/reason was considered and why the module evidence does not justify it. This is the anti-copy and anti-invention gate.
8. Implement the smallest stable public model. Keep native details in a classifier or runtime diagnostic channel; expose only semantic data that callers can recover from, report, retry, or serialize.
9. Finish the change, including construction/classification, handling, schema-boundary, and compatibility tests required by the changed surface. Do not add serialization or old-payload migration tests when the module has no serialization/persistence/transport contract; state that the check is not applicable.

## Completion contract

Before declaring the task complete, verify that:

- the evidence table covers every accepted public reason and field; no reference-only candidate remains in the public shape;
- every expected failure has an appropriate stable public discriminator (`_tag` when callers match or a union requires it; a deliberate schema identity is sufficient for an untagged `Schema.Error`), and no avoidable native error escapes the boundary;
- each field is bounded and has a demonstrated caller, diagnostic, telemetry, user-message, or wire-compatibility purpose; sensitive values, native provider objects, full bodies, and unbounded text are excluded or normalized;
- interruption and defects are not accidentally converted into ordinary public failures;
- reason handling uses the API that matches the actual shape (`catchTag`/`catchTags` for independent tagged errors, `catchReason`/`catchReasons` for a wrapper with nested reasons, or deliberate `unwrapReason` when wrapper context is intentionally discarded);
- every accepted reason has a relevant non-match or preservation test, and no invented failure category is added just to complete a taxonomy;
- schema encode/decode behavior and old payload compatibility are covered only when that boundary exists, with actual encoded output checked for redaction;
- focused type checks, tests, and lint have been run according to the repository instructions, or any unavailable validation is reported honestly;
- the final result includes: evidence table, rejected candidates, smallest shape, Effect source landing, handling guidance, focused test matrix, and validation result.

Keep public tags, schema identity, and field meanings stable. Treat a serialized error schema as an API contract. For detailed rules, load only the reference that matches the active decision.
