import { Effect, FileSystem, Schema, Stream } from "effect";
import { ByteWriter, ParquetWriter, schemaFromColumnData } from "hyparquet-writer";
import { WriteFailed } from "#/StreamWriter.ts";
import type * as StreamWriter from "#/StreamWriter.ts";

const parquetValueColumn = "value";

const parquetRowGroupSize = 1000;

const parquetSchema = schemaFromColumnData({
  columnData: [{ name: parquetValueColumn, data: [], type: "JSON" }],
});

/**
 * A {@link ByteWriter} that hands the bytes buffered so far to the caller on
 * every flush, so the file is never held in memory as a whole.
 *
 * Flushing stays synchronous, so the write path can discard the writer's
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

export const parquetWriter = (fs: FileSystem.FileSystem): StreamWriter.Service => ({
  write: (schema) => {
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
      }).pipe(Effect.mapError((cause) => new WriteFailed({ cause })));
  },
});
