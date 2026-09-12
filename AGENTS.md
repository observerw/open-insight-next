<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

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

- **Effect Task Rule**: All Effect answers MUST include `node_modules/effect` source
  landing (file path + code). **STRICTLY FORBIDDEN** to fabricate APIs from
  memory. Always read source first.
- **Effect Code Quality**: Final code MUST use correct Effect APIs and style:
  `Effect.gen`/`Effect.fn`, `Match.tag`, `Equal.equals`, `Schema.TaggedError`,
  proper service patterns, Effect data structures. Naive implementations OK
  during exploration, but must refactor before delivery.
