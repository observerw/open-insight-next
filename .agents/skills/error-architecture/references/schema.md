# Schema Error APIs

Use this reference when implementing schema-backed errors, reason unions, causes, field optionality, or serialization boundaries.

## Verify before using

The examples in this file demonstrate API shape only. Their tags, identifiers, fields, and reason names are not defaults. Do not copy `message`, `operation`, `parameter`, `causeInfo`, `retryAfter`, or any example reason unless the target module's evidence table proves the same meaning and use.

Before writing an Effect API, read the matching source under this repository's installed `node_modules/effect/src` and record a source landing in the result: path, line range, and the relevant declaration or documentation excerpt. Confirm the installed package version and import namespace. Do not rely on memory or on this reference as an API substitute.

The source landing is evidence for API correctness, not evidence for a domain field or reason. Effect's own example names must not be treated as module requirements.

## Class choices

`Schema.TaggedError<Self>(identifier?)("Tag", fields)` adds a readonly literal `_tag: "Tag"`. It is appropriate for an ordinary public tagged error when callers match the error or it participates in a tagged union.

`Schema.Error<Self>(identifier)(fields)` does not add `_tag` automatically. Add `_tag: Schema.tag("Tag")` only when selective matching or tagged-union membership is part of the contract. The `identifier` is the stable schema/class identity; it is separate from the semantic `_tag` and must not depend on an operation, request, stack trace, or generated value.

For one observed tagged failure, the minimal API shape is:

```ts
import * as Schema from "effect/Schema";

export class ResourceMissing extends Schema.TaggedError<ResourceMissing>()("ResourceMissing", {}) {}
```

The empty field shape is intentional when no caller or boundary needs additional data. Add fields only after recording their module-local purpose.

For an explicit class where the schema identity and semantic tag must be controlled separately:

```ts
export class InvalidResult extends Schema.Error<InvalidResult>(
  "effect/example/ModuleError/InvalidResult",
)({
  _tag: Schema.tag("InvalidResult"),
}) {}
```

The identifier and tag above are API demonstrations, not names to reuse.

## Wrapper and reason union

Define reason classes first, then a named union, then the wrapper only when the module has multiple observed reasons that need one public channel or shared stable context. Each reason must have its own evidence row and a caller-visible distinction. A one-member union or wrapper around one observed failure is rejected.

```ts
export class ModuleReasonA extends Schema.TaggedError<ModuleReasonA>()("ModuleReasonA", {}) {}

export class ModuleReasonB extends Schema.TaggedError<ModuleReasonB>()("ModuleReasonB", {}) {}

export const ModuleReason = Schema.Union([ModuleReasonA, ModuleReasonB]);

export class ModuleError extends Schema.TaggedError<ModuleError>()("ModuleError", {
  reason: ModuleReason,
}) {}
```

This snippet shows nesting and matching shape only. Do not use it to justify two reasons, a wrapper, or empty placeholder variants in a real module. Export the reason type/schema only when callers classify, decode, or test reasons independently. Use `Effect.catchTag` or `catchTags` for independent tagged errors; use `Effect.catchReason` or `catchReasons` for a wrapper with nested reasons. Use `Effect.unwrapReason` only when downstream code intentionally no longer needs wrapper context. Use `Effect.catch` only for a handler that really handles all remaining recoverable failures; it does not recover defects.

## Cause and serialization

Do not copy `Schema.Defect()` into every reason. A public wire schema must not contain arbitrary native values by default. Choose one of these designs only when the module has the corresponding runtime or wire boundary:

- a runtime-only native `cause` plus a separate transport DTO;
- bounded `causeInfo`, such as a deliberately specified category/code/operation structure;
- an explicit encoder that removes or normalizes the native cause.

If there is no persistence, serialization, or transport contract, do not invent a DTO, encoded schema, old-payload migration, or compatibility layer. State that those checks are not applicable.

Test actual encoded output when a schema boundary exists. Assert that native values, secrets, and unbounded payloads cannot escape. Set `wrapper.cause = reason` only when the nested reason is intentionally the runtime cause; otherwise preserve native diagnostics separately and document that choice.

`Schema.Defect()` is a schema for unexpected values when carrying defects across a JSON boundary; it is not evidence that a public module error should expose arbitrary native causes.

## Field contracts

Use a stable literal `_tag` for matching; never parse `message`. Use bounded identifiers for operation/resource context only when callers or diagnostics need them. Use structured retry advice rather than message text only when the module owns retry behavior. For protocol failures, retain small status/code/request-id metadata or bounded raw data only when there is a deliberate need proven by the boundary and consumer.

Use `Schema.optional(...)` when absence and explicit `undefined` are both acceptable. Use `Schema.optionalKey(...)` when exact absent-key semantics matter. Do not make a field optional merely to avoid deciding its meaning.

Treat `_tag`, schema identity, and field meaning as public API. Add new variants and optional fields additively when old producers can omit them safely. A required new field can make old serialized errors undecodable; an optional field can preserve old data but may weaken invariants. Never rename or reuse a tag for another semantic failure.
