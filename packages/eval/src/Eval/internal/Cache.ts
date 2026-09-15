import type { TrailID } from "#/event/index.ts";
import * as Git from "@open-insight/core/Git";
import { Effect, FileSystem, Path } from "effect";

const NAMESPACE = "eval" as const;

const ensureDir = Effect.fn(function* (evalID: string) {
  const git = yield* Git.Service;
  const path = yield* Path.Path;

  const commit = yield* git.commitHash;

  return yield* ensureDir({ subdir: path.join(NAMESPACE, commit, evalID) });
}, Effect.provide(Git.Service.layer));

export const trailCache = Effect.fn(function* ({ evalID, taskID, trailIdx }: TrailID) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const cacheDir = yield* ensureDir(evalID);
  const file = path.join(cacheDir, `${taskID}-${trailIdx}.jsonl`);

  const exists = yield* fs.exists(file);
  return { file, exists };
});
