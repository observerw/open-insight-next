# Toolchains

- This project use deno. Do not use `npm` or `node`.

# Effect-TS

This repository uses the `effect` library.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in
`node_modules/effect/src`.

# Rules

## General

- When debugging type-related issues, STRICTLY FORBIDDEN to annotate types
  manually just to make the type checker happy. Fix the real underlying type
  issue. If you are unsure how to fix it, ask for help.

## Code Quality

- **Code quality is top priority**: Code that merely "works" but has messy,
  convoluted design is STILL unacceptable. Deliver clean, minimal, and
  well-structured code — nothing more, nothing less.
- **Do not be "smart"**: Do NOT make extra designs or additions that the user
  did NOT explicitly request.
- **No unnecessary abstractions**: Do NOT add forward compatibility layers,
  premature generalization, or speculative features unless explicitly asked.
- **DO NOT dig for outdated implementations** unless explicitly asked. This
  includes searching through git history for historical implementations. Always
  implement features from a fresh, simplest perspective.

## Effect

- **Effect Task Rule**: All Effect answers MUST include `packages/effect` source
  landing (file path + code). **STRICTLY FORBIDDEN** to fabricate APIs from
  memory. Always read source first.
- **Effect Code Quality**: Final code MUST use correct Effect APIs and style:
  `Effect.gen`/`Effect.fn`, `Match.tag`, `Equal.equals`, `Schema.TaggedError`,
  proper service patterns, Effect data structures. Naive implementations OK
  during exploration, but must refactor before delivery.
