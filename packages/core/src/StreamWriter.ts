import { Context, Effect, FileSystem, Formatter, Layer, Schema, Stream } from "effect";
import { Ndjson } from "effect/unstable/encoding";
import { parquetWriter } from "#/internal/parquet.ts";

export class WriteFailed extends Schema.TaggedError<WriteFailed>(
  "open-insight/core/StreamWriterError/WriteFailed",
)("WriteFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to write stream: ${Formatter.format(this.cause)}`;
  }
}

export interface Service {
  readonly write: <S extends Schema.Constraint>(
    schema: S,
  ) => <E, R>(
    key: string,
    values: Stream.Stream<S["Type"], E, R>,
  ) => Effect.Effect<void, E | WriteFailed, R | S["EncodingServices"]>;
}

export class StreamWriter extends Context.Service<StreamWriter, Service>()(
  "open-insight/core/StreamWriter",
) {
  /** Writes records as newline-delimited JSON, one record per line. */
  static readonly layer: Layer.Layer<StreamWriter, never, FileSystem.FileSystem> = Layer.effect(
    StreamWriter,
    Effect.map(FileSystem.FileSystem, (fs): Service => ({
      write: (schema) => {
        const encoder = Ndjson.encodeSchema(schema);

        return (key, values) =>
          values.pipe(
            Stream.pipeThroughChannel(encoder()),
            Stream.run(fs.sink(key)),
            Effect.mapError((cause) => new WriteFailed({ cause })),
          );
      },
    })),
  );

  /**
   * Writes each record as a JSON value in a single parquet column.
   *
   * **Details**
   *
   * Records are encoded and written one row group at a time, so writing a long
   * stream holds neither the whole dataset nor the whole file in memory.
   */
  static readonly layerParquet: Layer.Layer<StreamWriter, never, FileSystem.FileSystem> =
    Layer.effect(StreamWriter, Effect.map(FileSystem.FileSystem, parquetWriter));
}
