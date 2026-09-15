import { Context, Effect, FileSystem, Formatter, Layer, Schema, Stream } from "effect";
import { Ndjson } from "effect/unstable/encoding";

export class SaveFailed extends Schema.TaggedError<SaveFailed>(
  "open-insight/core/NdjsonStoreError/SaveFailed",
)("SaveFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `NDJSON persistence failed: ${Formatter.format(this.cause)}`;
  }
}

export class LoadFailed extends Schema.TaggedError<LoadFailed>(
  "open-insight/core/NdjsonStoreError/LoadFailed",
)("LoadFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `NDJSON loading failed: ${Formatter.format(this.cause)}`;
  }
}

export type NdjsonStoreError = SaveFailed | LoadFailed;

export class NdjsonStore extends Context.Service<
  NdjsonStore,
  {
    readonly save: <S extends Schema.Constraint>(
      schema: S,
    ) => <E, R>(
      path: string,
      values: Stream.Stream<S["Type"], E, R>,
    ) => Effect.Effect<void, E | SaveFailed, R | S["EncodingServices"]>;
    readonly load: <S extends Schema.Constraint>(
      schema: S,
    ) => (path: string) => Stream.Stream<S["Type"], LoadFailed, S["DecodingServices"]>;
  }
>()("open-insight/core/NdjsonStore") {
  static readonly layer = Layer.effect(
    NdjsonStore,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const save: NdjsonStore["Service"]["save"] = (schema) => {
        const encoder = Ndjson.encodeSchema(schema);

        return (path, values) =>
          values.pipe(
            Stream.pipeThroughChannel(encoder()),
            Stream.run(fs.sink(path)),
            Effect.mapError((cause) => new SaveFailed({ cause })),
          );
      };

      const load: NdjsonStore["Service"]["load"] = (schema) => {
        const decoder = Ndjson.decodeSchema(schema);

        return (path) =>
          fs.stream(path).pipe(
            Stream.pipeThroughChannel(decoder({ ignoreEmptyLines: true })),
            Stream.mapError((cause) => new LoadFailed({ cause })),
          );
      };

      return NdjsonStore.of({ save, load });
    }),
  );
}
