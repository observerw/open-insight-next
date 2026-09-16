import { Context, Effect, FileSystem, Formatter, Layer, Schema, Sink, Stream } from "effect";
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

export interface LoadOptions {
  readonly offset?: number;
  readonly limit?: number;
}

export interface Backend<E = unknown> {
  readonly sink: (key: string) => Sink.Sink<void, Uint8Array, never, E>;
  readonly stream: (key: string) => Stream.Stream<Uint8Array, E>;
}

export interface Service {
  readonly save: <S extends Schema.Constraint>(
    schema: S,
  ) => <E, R>(
    key: string,
    values: Stream.Stream<S["Type"], E, R>,
  ) => Effect.Effect<void, E | SaveFailed, R | S["EncodingServices"]>;

  readonly load: <S extends Schema.Constraint>(
    schema: S,
  ) => (
    key: string,
    options?: LoadOptions,
  ) => Stream.Stream<S["Type"], LoadFailed, S["DecodingServices"]>;
}

export const make = <E>(backend: Backend<E>): Service => {
  const save: Service["save"] = (schema) => {
    const encoder = Ndjson.encodeSchema(schema);

    return (key, values) =>
      values.pipe(
        Stream.pipeThroughChannel(encoder()),
        Stream.run(backend.sink(key)),
        Effect.mapError((cause) => new SaveFailed({ cause })),
      );
  };

  const load: Service["load"] = (schema) => {
    const decoder = Ndjson.decodeSchema(schema);

    return (key, options) =>
      backend.stream(key).pipe(
        Stream.pipeThroughChannel(decoder({ ignoreEmptyLines: true })),
        Stream.drop(options?.offset ?? 0),
        options?.limit === undefined ? (stream) => stream : Stream.take(options.limit),
        Stream.mapError((cause) => new LoadFailed({ cause })),
      );
  };

  return { save, load };
};

export class NdjsonStore extends Context.Service<NdjsonStore, Service>()(
  "open-insight/core/NdjsonStore",
) {
  static readonly layer: Layer.Layer<NdjsonStore, never, FileSystem.FileSystem> = Layer.effect(
    NdjsonStore,
    Effect.map(FileSystem.FileSystem, ({ sink, stream }) => make({ sink, stream })),
  );
}

export const layerFromBackend = <E>(backend: Backend<E>): Layer.Layer<NdjsonStore> =>
  Layer.succeed(NdjsonStore, make(backend));
