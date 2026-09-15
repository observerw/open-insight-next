import { Context, Effect, Layer, Schema, Stream } from "effect";
import type { Tool } from "effect/unstable/ai";
import { FileSystem } from "#/FileSystem.ts";
import * as Trajectory from "./Trajectory.ts";
import type { PartEncoded } from "./Trajectory.ts";
import { decodeError, persistenceError, type TrajectoryError } from "./TrajectoryError.ts";

export class Persist extends Context.Service<
  Persist,
  {
    readonly save: <Tools extends Record<string, Tool.Any>>(
      path: string,
      trajectory: Trajectory.Trajectory<Tools>,
    ) => Effect.Effect<void, TrajectoryError, Tool.ResultEncodingServices<Tools[keyof Tools]>>;
    readonly load: (path: string) => Effect.Effect<Trajectory.Any, TrajectoryError>;
  }
>()("open-insight/TrajectoryPersist") {
  static readonly layer = Layer.effect(
    Persist,
    Effect.gen(function* () {
      const fs = yield* FileSystem;

      const save = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
        path: string,
        trajectory: Trajectory.Trajectory<Tools>,
      ) {
        const encoded = Trajectory.encode(trajectory);
        const parts = yield* Stream.runCollect(encoded);

        const content = yield* Effect.try({
          try: () =>
            JSON.stringify({
              metadata: trajectory.metadata,
              parts: Array.from(parts),
            }),
          catch: (cause) => persistenceError("save", path, cause),
        });

        yield* fs
          .writeFileString(path, content)
          .pipe(Effect.mapError((cause) => persistenceError("save", path, cause)));
      }) satisfies Persist["Service"]["save"];

      const load = Effect.fn(function* (path: string) {
        const content = yield* fs
          .readFileString(path)
          .pipe(Effect.mapError((cause) => persistenceError("load", path, cause)));

        const document = yield* Effect.try({ try: () => JSON.parse(content), catch: decodeError });

        const [metadata, parts] = yield* Effect.all([
          Schema.decodeUnknownEffect(Trajectory.Metadata)(document.metadata).pipe(
            Effect.mapError(decodeError),
          ),
          Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown))(document.parts).pipe(
            Effect.mapError(decodeError),
            Effect.map((parts) => parts as PartEncoded[]),
          ),
        ]);

        const trajectory = yield* Trajectory.decode(Stream.fromIterable(parts));

        return Trajectory.metadata(trajectory, metadata);
      }) satisfies Persist["Service"]["load"];

      return { save, load };
    }),
  );
}
