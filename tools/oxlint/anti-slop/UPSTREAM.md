# anti-slop provenance

- Source: https://github.com/dmmulroy/anti-slop
- Revision: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Obtained via: the `install-anti-slop` skill bundle
  (`skills/install-anti-slop/assets/anti-slop`), copied with that skill's
  `scripts/install.mjs`.
- Installed entry points:
  - `tools/oxlint/anti-slop/index.ts` — generic `anti-slop` plugin
  - `tools/oxlint/anti-slop/effect/index.ts` — opt-in `anti-slop-effect` plugin
- Bundled vendored code: `tools/oxlint/anti-slop/vendor/eslint-stylistic/`
  (`LICENSE` and `UPSTREAM.md` travel with the `require-readable-spacing` rule).
- Intentional deviations: none.

This is a pristine copy of the upstream source. anti-slop is meant to be vendored,
so edit these files directly to match this repository's standards.
