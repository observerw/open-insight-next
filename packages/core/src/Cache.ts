import { Effect, FileSystem, Match, Path } from "effect";

const CACHE_DIR = ".open-insight" as const;

/**
 * Resolve the cache directory path from configuration and ensure it exists on
 * disk. Returns the absolute or relative path as configured.
 */
export const ensureDir = Effect.fn(function* ({
  subdir = "",
  global = false,
}: Readonly<{
  subdir?: string;
  global?: boolean;
}>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const dir = yield* Match.value(global)
    .pipe(
      Match.when(true, () => fs.makeTempDirectory({ prefix: CACHE_DIR })),
      Match.when(false, () => Effect.succeed(path.resolve(CACHE_DIR))),
      Match.exhaustive,
    )
    .pipe(Effect.map((dir) => path.resolve(dir, subdir)));

  yield* fs.makeDirectory(dir, { recursive: true });

  return dir;
});
