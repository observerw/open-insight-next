import { Context, Effect, FileSystem, Formatter, Layer, Schema, Stream } from "effect";
import { Ndjson } from "effect/unstable/encoding";

export class ReadFailed extends Schema.TaggedError<ReadFailed>(
  "open-insight/core/StreamReaderError/ReadFailed",
)("ReadFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to read stream: ${Formatter.format(this.cause)}`;
  }
}

export interface Service {
  readonly read: <S extends Schema.Constraint>(
    schema: S,
  ) => (key: string) => Stream.Stream<S["Type"], ReadFailed, S["DecodingServices"]>;
}

export class StreamReader extends Context.Service<StreamReader, Service>()(
  "open-insight/core/StreamReader",
) {
  /** Reads records stored as newline-delimited JSON, one record per line. */
  static readonly layer: Layer.Layer<StreamReader, never, FileSystem.FileSystem> = Layer.effect(
    StreamReader,
    Effect.map(FileSystem.FileSystem, (fs): Service => ({
      read: (schema) => {
        const decoder = Ndjson.decodeSchema(schema);

        return (key) =>
          fs.stream(key).pipe(
            Stream.pipeThroughChannel(decoder({ ignoreEmptyLines: true })),
            Stream.mapError((cause) => new ReadFailed({ cause })),
          );
      },
    })),
  );
}
