import { Effect, FileSystem, Path } from "effect";
import { Cache, Git } from "@open-insight/core";
import type { TrailID } from "#/Event.ts";

const NAMESPACE = "eval" as const;

export const ensureDir = Effect.fn(function* (evalID: string) {
  const git = yield* Git.Git;
  const path = yield* Path.Path;

  const commit = yield* git.commitHash;
  return yield* Cache.ensureDir({ subdir: path.join(NAMESPACE, commit, evalID) });
}, Effect.provide(Git.Git.layer));

export const trailCache = Effect.fn(function* ({ evalID, taskID, trailIdx }: TrailID) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const cacheDir = yield* ensureDir(evalID);
  const file = path.join(cacheDir, `${taskID}-${trailIdx}.jsonl`);

  const exists = yield* fs.exists(file);
  return { file, exists };
});
