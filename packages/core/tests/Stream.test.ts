import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema, Sink, Stream } from "effect";
import { parquetReadObjects } from "hyparquet";
import * as StreamReader from "#/StreamReader.ts";
import * as StreamWriter from "#/StreamWriter.ts";

const inMemoryFileSystem = <A>(layer: Layer.Layer<A, never, FileSystem.FileSystem>) => {
  const files = new Map<string, Array<Uint8Array>>();

  return {
    files,
    layer: layer.pipe(
      Layer.provide(
        FileSystem.layerNoop({
          sink: (path: string) =>
            Sink.forEach((chunk: Uint8Array) =>
              Effect.sync(() => {
                const chunks = files.get(path) ?? [];
                chunks.push(chunk.slice());
                files.set(path, chunks);
              }),
            ),
          stream: (path: string) => Stream.fromIterable(files.get(path) ?? []),
        }),
      ),
    ),
  };
};

const encode = (text: string) => new TextEncoder().encode(text);

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

const parquetValues = (chunks: ReadonlyArray<Uint8Array>) =>
  Effect.tryPromise(() => parquetReadObjects({ file: toArrayBuffer(chunks) })).pipe(
    Effect.map((rows) => rows.map((row) => row["value"])),
  );

it.effect("reads newline-delimited JSON records with schemas supplied per operation", () => {
  const memory = inMemoryFileSystem(StreamReader.StreamReader.layer);
  const User = Schema.Struct({ id: Schema.Number, name: Schema.String });

  memory.files.set("users.ndjson", [encode('{"id":1,"name":"Ada"}\n{"id":2,"name":"Grace"}\n')]);
  memory.files.set("labels.ndjson", [encode('"alpha"\n"beta"\n')]);

  return Effect.gen(function* () {
    const reader = yield* StreamReader.StreamReader;

    assert.deepStrictEqual(yield* Stream.runCollect(reader.read(User)("users.ndjson")), [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
    assert.deepStrictEqual(yield* Stream.runCollect(reader.read(Schema.String)("labels.ndjson")), [
      "alpha",
      "beta",
    ]);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("ignores empty lines while reading", () => {
  const memory = inMemoryFileSystem(StreamReader.StreamReader.layer);
  memory.files.set("values.ndjson", [encode("1\n\n2\n")]);

  return Effect.gen(function* () {
    const reader = yield* StreamReader.StreamReader;
    const values = yield* Stream.runCollect(reader.read(Schema.Number)("values.ndjson"));

    assert.deepStrictEqual(values, [1, 2]);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("classifies file-system read failures as ReadFailed", () =>
  Effect.gen(function* () {
    const reader = yield* StreamReader.StreamReader;

    const error = yield* Stream.runCollect(reader.read(Schema.String)("missing.ndjson")).pipe(
      Effect.flip,
    );

    assert.instanceOf(error, StreamReader.ReadFailed);
    assert.strictEqual(error._tag, "ReadFailed");
  }).pipe(
    Effect.provide(StreamReader.StreamReader.layer.pipe(Layer.provide(FileSystem.layerNoop({})))),
  ),
);

it.effect("writes records as newline-delimited JSON", () => {
  const memory = inMemoryFileSystem(StreamWriter.StreamWriter.layer);

  return Effect.gen(function* () {
    const writer = yield* StreamWriter.StreamWriter;

    yield* writer.write(Schema.Number)("values.ndjson", Stream.make(1, 2));

    const text = new TextDecoder().decode(toArrayBuffer(memory.files.get("values.ndjson") ?? []));
    assert.strictEqual(text, "1\n2\n");
  }).pipe(Effect.provide(memory.layer));
});

it.effect("classifies file-system write failures as WriteFailed", () =>
  Effect.gen(function* () {
    const writer = yield* StreamWriter.StreamWriter;

    const error = yield* writer
      .write(Schema.String)("unwritable.ndjson", Stream.make("value"))
      .pipe(Effect.flip);

    assert.instanceOf(error, StreamWriter.WriteFailed);
    assert.strictEqual(error._tag, "WriteFailed");
  }).pipe(
    Effect.provide(StreamWriter.StreamWriter.layer.pipe(Layer.provide(FileSystem.layerNoop({})))),
  ),
);

it.effect("writes records as a parquet file", () => {
  const memory = inMemoryFileSystem(StreamWriter.StreamWriter.layerParquet);

  const User = Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
    tags: Schema.Array(Schema.String),
  });

  return Effect.gen(function* () {
    const writer = yield* StreamWriter.StreamWriter;

    const users = [
      { id: 1, name: "Ada", tags: ["math"] },
      { id: 2, name: "Grace", tags: [] },
    ];

    yield* writer.write(User)("users.parquet", Stream.fromIterable(users));

    const chunks = memory.files.get("users.parquet") ?? [];
    const encoded = chunks[0] ?? new Uint8Array();
    assert.deepStrictEqual(Array.from(encoded.slice(0, 4)), [0x50, 0x41, 0x52, 0x31]);
    assert.deepStrictEqual(yield* parquetValues(chunks), users);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("writes values of any shape through parquet", () => {
  const memory = inMemoryFileSystem(StreamWriter.StreamWriter.layerParquet);

  return Effect.gen(function* () {
    const writer = yield* StreamWriter.StreamWriter;

    const values = [{ id: 1, nested: { list: [1, 2] } }, "text", 42, true];

    yield* writer.write(Schema.Unknown)("values.parquet", Stream.fromIterable(values));

    assert.deepStrictEqual(yield* parquetValues(memory.files.get("values.parquet") ?? []), values);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("writes records incrementally as the stream is consumed", () => {
  const memory = inMemoryFileSystem(StreamWriter.StreamWriter.layerParquet);
  const values = Array.from({ length: 2500 }, (_, index) => ({ index }));

  return Effect.gen(function* () {
    const writer = yield* StreamWriter.StreamWriter;

    yield* writer.write(Schema.Unknown)("many.parquet", Stream.fromIterable(values));

    const chunks = memory.files.get("many.parquet") ?? [];
    assert.isAbove(chunks.length, 1);
    assert.deepStrictEqual(yield* parquetValues(chunks), values);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("writes an empty parquet stream", () => {
  const memory = inMemoryFileSystem(StreamWriter.StreamWriter.layerParquet);

  return Effect.gen(function* () {
    const writer = yield* StreamWriter.StreamWriter;

    yield* writer.write(Schema.String)("empty.parquet", Stream.empty);

    assert.deepStrictEqual(yield* parquetValues(memory.files.get("empty.parquet") ?? []), []);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("classifies parquet write failures as WriteFailed", () =>
  Effect.gen(function* () {
    const writer = yield* StreamWriter.StreamWriter;

    const error = yield* writer
      .write(Schema.String)("unwritable.parquet", Stream.make("value"))
      .pipe(Effect.flip);

    assert.instanceOf(error, StreamWriter.WriteFailed);
    assert.strictEqual(error._tag, "WriteFailed");
  }).pipe(
    Effect.provide(
      StreamWriter.StreamWriter.layerParquet.pipe(Layer.provide(FileSystem.layerNoop({}))),
    ),
  ),
);
