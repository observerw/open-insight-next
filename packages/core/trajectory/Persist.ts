import { Context, Effect, FileSystem, Layer, Schema, Stream } from "effect";
import { Tool } from "effect/unstable/ai";
import { decode, encode, type TrajectoryEncoded } from "./decode.ts";
import { TrajectoryError } from "./error.ts";
import { Metadata } from "./metadata.ts";
import { toJsonSchema } from "./toolkit.ts";
import type { Trajectory } from "./trajectory.ts";

export class Persist extends Context.Service<
  Persist,
  {
    readonly save: <Tools extends Record<string, Tool.Any>>(
      path: string,
      trajectory: Trajectory<Tools>,
    ) => Effect.Effect<
      void,
      TrajectoryError,
      Tool.ResultEncodingServices<Tools[keyof Tools]>
    >;
    readonly load: (
      path: string,
    ) => Effect.Effect<Trajectory<{}>, TrajectoryError>;
  }
>()("open-insight/TrajectoryPersist") {
  static readonly layer = Layer.effect(
    Persist,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const save = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
        path: string,
        trajectory: Trajectory<Tools>,
      ) {
        const metadata = yield* Effect.try({
          try: () => JSON.stringify(trajectory.metadata),
          catch: TrajectoryError.storage,
        });
        const toolkit = yield* Effect.try({
          try: () => JSON.stringify(toJsonSchema(trajectory.toolkit)),
          catch: TrajectoryError.storage,
        });
        const lines = yield* Stream.runFold(
          encode(trajectory),
          () => `${metadata}\n${toolkit}\n`,
          (text, part) => `${text}${JSON.stringify(part)}\n`,
        );
        yield* fs
          .writeFileString(
            path.endsWith(".traj") ? path : `${path}.traj`,
            lines,
          )
          .pipe(Effect.mapError(TrajectoryError.storage));
      }) satisfies Persist["Service"]["save"];

      const load = Effect.fn(function* (path: string) {
        const content = yield* fs
          .readFileString(path.endsWith(".traj") ? path : `${path}.traj`)
          .pipe(Effect.mapError(TrajectoryError.storage));
        const lines = content.split("\n").filter((line) => line.length > 0);
        if (lines.length < 2) {
          return yield* Effect.fail(
            TrajectoryError.storage(new Error("Invalid trajectory file")),
          );
        }
        const metadata = yield* Effect.try({
          try: () => JSON.parse(lines[0]),
          catch: TrajectoryError.decode,
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Metadata)),
          Effect.mapError(TrajectoryError.decode),
        );
        const encoded: TrajectoryEncoded = Stream.fromIterable(
          yield* Effect.forEach(lines.slice(2), (line) =>
            Effect.try({
              try: () => JSON.parse(line),
              catch: TrajectoryError.decode,
            })),
        );
        const trajectory = yield* decode(encoded);
        return Object.assign(trajectory, { metadata });
      }) satisfies Persist["Service"]["load"];

      return { save, load };
    }),
  );
}
