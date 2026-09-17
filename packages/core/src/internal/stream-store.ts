import { Effect, FileSystem, Schema, Stream } from "effect";
import { Ndjson } from "effect/unstable/encoding";
import { parquetReadObjects } from "hyparquet";
import { ByteWriter, ParquetWriter, schemaFromColumnData } from "hyparquet-writer";
import { LoadFailed, SaveFailed } from "#/StreamStore.ts";
import type { Service } from "#/StreamStore.ts";

export const ndjsonService = (fs: FileSystem.FileSystem): Service => {
  const save: Service["save"] = (schema) => {
    const encoder = Ndjson.encodeSchema(schema);

    return (key, values) =>
      values.pipe(
        Stream.pipeThroughChannel(encoder()),
        Stream.run(fs.sink(key)),
        Effect.mapError((cause) => new SaveFailed({ cause })),
      );
  };

  const load: Service["load"] = (schema) => {
    const decoder = Ndjson.decodeSchema(schema);

    return (key, options) =>
      fs.stream(key).pipe(
        Stream.pipeThroughChannel(decoder({ ignoreEmptyLines: true })),
        Stream.drop(options?.offset ?? 0),
        Stream.take(options?.limit ?? Number.POSITIVE_INFINITY),
        Stream.mapError((cause) => new LoadFailed({ cause })),
      );
  };

  return { save, load };
};

const parquetValueColumn = "value";

const parquetRowGroupSize = 1000;

const parquetSchema = schemaFromColumnData({
  columnData: [{ name: parquetValueColumn, data: [], type: "JSON" }],
});

/**
 * A {@link ByteWriter} that hands the bytes buffered so far to the caller on
 * every flush, so the file is never held in memory as a whole.
 *
 * Flushing stays synchronous, so the save path can discard the writer's
 * `void | Promise<void>` results.
 */
class SpillWriter extends ByteWriter {
  private readonly chunks: Array<Uint8Array> = [];

  override finish(): void {
    this.flush();
  }

  flush(): void {
    if (this.index > 0) {
      this.chunks.push(new Uint8Array(this.buffer.slice(0, this.index)));
      this.index = 0;
    }
  }

  take(): Array<Uint8Array> {
    return this.chunks.splice(0);
  }
}

const toArrayBuffer = (chunks: ReadonlyArray<Uint8Array>): ArrayBuffer => {
  const buffer = new ArrayBuffer(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return buffer;
};

export const parquetService = (fs: FileSystem.FileSystem): Service => {
  const save: Service["save"] = (schema) => {
    const encode = Schema.encodeEffect(schema);

    return (key, values) =>
      Effect.gen(function* () {
        const writer = new SpillWriter();
        const parquet = new ParquetWriter({ schema: parquetSchema, writer });

        const rowGroups = values.pipe(
          Stream.mapEffect((value) => encode(value)),
          Stream.grouped(parquetRowGroupSize),
          Stream.mapEffect((rows) =>
            Effect.try(() => {
              void parquet.write({
                columnData: [{ name: parquetValueColumn, data: Array.from(rows) }],
                rowGroupSize: parquetRowGroupSize,
              });

              return writer.take();
            }),
          ),
          Stream.flattenIterable,
        );

        const footer = Stream.fromEffect(
          Effect.try(() => {
            void parquet.finish();

            return writer.take();
          }),
        ).pipe(Stream.flattenIterable);

        yield* Stream.concat(rowGroups, footer).pipe(Stream.run(fs.sink(key)));
      }).pipe(Effect.mapError((cause) => new SaveFailed({ cause })));
  };

  const load: Service["load"] = (schema) => {
    const decode = Schema.decodeUnknownEffect(schema);

    return (key, options) => {
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? Number.POSITIVE_INFINITY;

      return Stream.unwrap(
        Effect.gen(function* () {
          const chunks = yield* Stream.runCollect(fs.stream(key));

          // The requested window is pushed into the read so rows outside it are
          // never decoded. An unlimited request keeps hyparquet's own default.
          const rows = yield* Effect.tryPromise(() =>
            parquetReadObjects({
              file: toArrayBuffer(chunks),
              rowStart: offset,
              rowEnd: offset + limit,
            }),
          );

          return Stream.fromIterable(rows);
        }),
      ).pipe(
        Stream.mapEffect((row) => decode(row[parquetValueColumn])),
        Stream.mapError((cause) => new LoadFailed({ cause })),
      );
    };
  };

  return { save, load };
};
