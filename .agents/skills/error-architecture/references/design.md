# Semantic Design

Use this reference for choosing the public error shape, grouping failure reasons, and designing fields. The goal is a stable answer to: "What failure can a caller recognize and act on?"

## Read this first

The vocabulary below is a search aid, not a menu of errors. A tag, reason, or field name is only a hypothesis until the target module's source, consumer, boundary signal, or existing wire contract proves it. Never copy a name or field from this document into a design without an evidence-table row.

The design order is deliberately strict:

1. State what the module promises.
2. Inspect entry points, existing error definitions, construction/classification sites, consumers, boundary signals, and nearby tests.
3. Record observed failures and caller actions with source locations.
4. Group or split observed outcomes according to caller behavior.
5. Name tags and choose fields only after the grouping is justified.
6. Put unproven candidates in a rejection table. Do not add them as placeholders.

If you cannot inspect the implementation or find a consumer action, report the missing evidence instead of completing the taxonomy with generic `UnknownError`, `message`, `cause`, `operation`, or `reason` fields.

## Choose the shape

Use the least powerful shape that remains stable and is supported by the evidence:

- One observed semantic failure with tagged handling: one `Schema.TaggedError` with only caller-relevant fields. An empty field shape is valid.
- One structured error without a meaningful discriminator: `Schema.Error`; add a literal tag only when selective handling or tagged-union membership is an observed contract.
- Several observed categories at one module boundary: a tagged wrapper with `reason: Schema.Union([...])` only when callers need one error channel or shared stable module context and the nested reasons have meaningful distinct handling.
- Independent observed errors with no shared context: a flat union of tagged errors. Do not add a wrapper for visual uniformity.
- Internal translation only: keep the classifier private and convert native/platform errors at the public boundary.

A wrapper is justified by the module evidence, not by the number of examples in a reference. Do not create a one-member union or wrapper around a single failure. Do not expose a reason per helper, dependency, exception name, implementation phase, or transport detail.

## Derive reason tags

Work from the module boundary, not stack frames or a general taxonomy:

1. State the operation's domain promise: read a resource, submit a command, decode a message, load configuration, and so on.
2. List only observed outcomes in domain language: credentials rejected, resource absent, response violates the contract, dependency unreachable.
3. For each outcome, name the caller action: return a fallback, ask for credentials, stop, retry safely, reconcile a mutation, or report a user/API error.
4. Group outcomes only when the evidence shows the same handler, retry policy, side-effect safety, user/API meaning, required fields, and serialization meaning.
5. Split when a material answer is no. A difference in internal phase is not enough.
6. Choose a stable noun that remains meaningful if the implementation changes.
7. Add only fields needed for the demonstrated action, diagnosis, telemetry, or wire contract.

For candidate reasons `A` and `B`, ask:

- Would callers use the same handler and recovery policy?
- Are retryability and side-effect safety the same?
- Is the user, API, or protocol meaning the same?
- Can the required fields be shared without vague properties?
- Would shared metrics or alerts lose useful signal?

These questions are applied to observed outcomes. They do not justify adding outcomes that were never found.

## Starting vocabulary (search only)

Use these words to search existing code and provider mappings, never to invent a union:

- Input/contract: `InvalidRequest`, `InvalidArgument`, `Unsupported`.
- Representation/protocol: `DecodeError`, `EncodeError`, `SerializationError`, `ProtocolError`, `InvalidOutput`.
- Identity/access: `AuthenticationError`, `AuthorizationError`, `NotFound`, `AlreadyExists`, `Conflict`.
- Availability/transport: `ConnectionError`, `TimeoutError`, `RateLimitError`, `Unavailable`.
- Remote/domain outcome: `QuotaExceeded`, `ContentPolicyViolation`, or another external rejection.
- State/concurrency: `TransactionConflict`, `StaleState`, `Deadlock`, `InvalidState`, `Closed`.
- Incomplete classification: `UnknownError` only at a real boundary where the category cannot be established and the caller has a reason to distinguish that condition.

Evidence must determine whether a word is appropriate. A malformed response body is a decode failure; parsed data that violates a wire contract is a protocol failure; a valid error envelope rejecting a request is a domain/external-system reason. An unfamiliar but valid external code should map to a bounded generic external reason only if the module actually exposes that boundary and callers need to handle it.

Keep authentication separate from authorization only when the boundary reliably distinguishes them and callers act differently. Treat `NotFound` as absence only when the authoritative boundary supports that meaning; use `StaleState` or `Conflict` for stale tokens and concurrency semantics.

## Fields and timeout policy

Every field needs an answer to a concrete question: who reads it, what action does it enable, what diagnostic or telemetry query does it support, or what wire compatibility requires it? The answer must cite a module-local source location. A field copied from an example is rejected.

Typical fields such as `operation`, `resource`, `id`, `parameter`, `expected`, `status`, `code`, `retryAfter`, `requestId`, and safe normalized metadata are possibilities, not defaults. Do not add `message`, `causeInfo`, an operation name, or an identifier merely because they are common.

Keep credentials, tokens, sensitive headers, full request bodies, native provider objects, and unbounded response text out of public fields. Bound identifiers and diagnostic strings, or omit them. Keep native causes runtime-only unless a deliberate bounded diagnostic contract exists.

A timeout says that the deadline expired; it does not prove that a remote mutation failed. Preserve caller cancellation as interruption. For module-owned deadlines, record dispatch certainty only when the boundary knows it and retry safety depends on it:

- `dispatch: "not-sent"`: retry may be safe;
- `dispatch: "sent"`: completion is unknown; reconcile before retrying a mutation;
- `dispatch: "unknown"`: be conservative.

Prefer structured policy such as `retrySafety: "safe" | "conditional" | "unsafe" | "unknown"` and optional `retryAfter` over an unconditional `isRetryable`, but only when the module has an actual retry policy to expose. A read may be safe to retry; a mutation requires idempotency or stable deduplication.
