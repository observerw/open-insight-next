import { Context, Effect, FileSystem, Formatter, Layer, Schema, Stream } from "effect";
import { ndjsonService, parquetService } from "#/internal/stream-store.ts";

export class SaveFailed extends Schema.TaggedError<SaveFailed>(
  "open-insight/core/StreamStoreError/SaveFailed",
)("SaveFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to save stream: ${Formatter.format(this.cause)}`;
  }
}

export class LoadFailed extends Schema.TaggedError<LoadFailed>(
  "open-insight/core/StreamStoreError/LoadFailed",
)("LoadFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to load stream: ${Formatter.format(this.cause)}`;
  }
}

export type StreamStoreError = SaveFailed | LoadFailed;

export interface LoadOptions {
  readonly offset?: number;
  readonly limit?: number;
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

export class StreamStore extends Context.Service<StreamStore, Service>()(
  "open-insight/core/StreamStore",
) {
  /** Persists records as newline-delimited JSON, one record per line. */
  static readonly layer: Layer.Layer<StreamStore, never, FileSystem.FileSystem> = Layer.effect(
    StreamStore,
    Effect.map(FileSystem.FileSystem, ndjsonService),
  );

  /**
   * Persists each record as a JSON value in a single parquet column.
   *
   * **Details**
   *
   * Records are encoded and written one row group at a time, so saving a long
   * stream holds neither the whole dataset nor the whole file in memory. Loading
   * buffers the file and decodes only the requested window of rows.
   */
  static readonly layerParquet: Layer.Layer<StreamStore, never, FileSystem.FileSystem> =
    Layer.effect(StreamStore, Effect.map(FileSystem.FileSystem, parquetService));
}
