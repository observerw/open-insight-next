import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema, Sink, Stream } from "effect";
import * as StreamStore from "#/StreamStore.ts";

const provideFileStore = (
  store: Layer.Layer<StreamStore.StreamStore, never, FileSystem.FileSystem>,
  fileSystem: Layer.Layer<FileSystem.FileSystem>,
): Layer.Layer<StreamStore.StreamStore> => store.pipe(Layer.provide(fileSystem));

const inMemoryFileSystem = (
  store: Layer.Layer<StreamStore.StreamStore, never, FileSystem.FileSystem>,
) => {
  const files = new Map<string, Array<Uint8Array>>();

  const layer = provideFileStore(
    store,
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
  );

  return { files, layer };
};

it.effect("saves and loads streams with schemas supplied per operation", () => {
  const memory = inMemoryFileSystem(StreamStore.StreamStore.layer);
  const User = Schema.Struct({ id: Schema.Number, name: Schema.String });
  const Label = Schema.String;

  return Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;

    const users = [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ];

    const labels = ["alpha", "beta"];

    yield* store.save(User)("users.ndjson", Stream.fromIterable(users));
    yield* store.save(Label)("labels.ndjson", Stream.fromIterable(labels));

    assert.deepStrictEqual(yield* Stream.runCollect(store.load(User)("users.ndjson")), users);
    assert.deepStrictEqual(yield* Stream.runCollect(store.load(Label)("labels.ndjson")), labels);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("ignores empty lines while loading", () => {
  const memory = inMemoryFileSystem(StreamStore.StreamStore.layer);
  memory.files.set("values.ndjson", [new TextEncoder().encode("1\n\n2\n")]);

  return Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;
    const values = yield* Stream.runCollect(store.load(Schema.Number)("values.ndjson"));

    assert.deepStrictEqual(values, [1, 2]);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("loads records with offset and limit", () => {
  const memory = inMemoryFileSystem(StreamStore.StreamStore.layer);
  memory.files.set("values.ndjson", [new TextEncoder().encode("1\n\n2\n3\n4\n")]);

  return Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;
    const load = store.load(Schema.Number);

    assert.deepStrictEqual(
      yield* Stream.runCollect(load("values.ndjson", { offset: 1, limit: 2 })),
      [2, 3],
    );
    assert.deepStrictEqual(yield* Stream.runCollect(load("values.ndjson", { offset: 2 })), [3, 4]);
    assert.deepStrictEqual(yield* Stream.runCollect(load("values.ndjson", { limit: 0 })), []);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("classifies file-system write failures as SaveFailed", () =>
  Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;

    const error = yield* store
      .save(Schema.String)("unwritable.ndjson", Stream.make("value"))
      .pipe(Effect.flip);

    assert.instanceOf(error, StreamStore.SaveFailed);
    assert.strictEqual(error._tag, "SaveFailed");
  }).pipe(
    Effect.provide(provideFileStore(StreamStore.StreamStore.layer, FileSystem.layerNoop({}))),
  ),
);

it.effect("classifies file-system read failures as LoadFailed", () =>
  Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;

    const error = yield* Stream.runCollect(store.load(Schema.String)("missing.ndjson")).pipe(
      Effect.flip,
    );

    assert.instanceOf(error, StreamStore.LoadFailed);
    assert.strictEqual(error._tag, "LoadFailed");
  }).pipe(
    Effect.provide(provideFileStore(StreamStore.StreamStore.layer, FileSystem.layerNoop({}))),
  ),
);

it.effect("saves records as parquet and loads them back", () => {
  const memory = inMemoryFileSystem(StreamStore.StreamStore.layerParquet);

  const User = Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
    tags: Schema.Array(Schema.String),
  });

  return Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;

    const users = [
      { id: 1, name: "Ada", tags: ["math"] },
      { id: 2, name: "Grace", tags: [] },
    ];

    yield* store.save(User)("users.parquet", Stream.fromIterable(users));

    const encoded = memory.files.get("users.parquet")?.[0] ?? new Uint8Array();
    assert.deepStrictEqual(Array.from(encoded.slice(0, 4)), [0x50, 0x41, 0x52, 0x31]);
    assert.deepStrictEqual(yield* Stream.runCollect(store.load(User)("users.parquet")), users);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("round-trips values of any shape through parquet", () => {
  const memory = inMemoryFileSystem(StreamStore.StreamStore.layerParquet);

  return Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;

    const values = [{ id: 1, nested: { list: [1, 2] } }, "text", 42, true];

    yield* store.save(Schema.Unknown)("values.parquet", Stream.fromIterable(values));

    assert.deepStrictEqual(
      yield* Stream.runCollect(store.load(Schema.Unknown)("values.parquet")),
      values,
    );
  }).pipe(Effect.provide(memory.layer));
});

it.effect("loads parquet records with offset and limit", () => {
  const memory = inMemoryFileSystem(StreamStore.StreamStore.layerParquet);

  return Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;

    yield* store.save(Schema.Number)("values.parquet", Stream.make(1, 2, 3, 4));

    const load = store.load(Schema.Number);

    assert.deepStrictEqual(
      yield* Stream.runCollect(load("values.parquet", { offset: 1, limit: 2 })),
      [2, 3],
    );
    assert.deepStrictEqual(yield* Stream.runCollect(load("values.parquet", { offset: 2 })), [3, 4]);
    assert.deepStrictEqual(yield* Stream.runCollect(load("values.parquet", { limit: 0 })), []);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("decodes only the requested parquet window", () => {
  const memory = inMemoryFileSystem(StreamStore.StreamStore.layerParquet);

  return Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;

    yield* store.save(Schema.Unknown)("values.parquet", Stream.make(1, "boom", 3));

    assert.deepStrictEqual(
      yield* Stream.runCollect(store.load(Schema.Number)("values.parquet", { limit: 1 })),
      [1],
    );
    assert.deepStrictEqual(
      yield* Stream.runCollect(store.load(Schema.Number)("values.parquet", { offset: 2 })),
      [3],
    );
  }).pipe(Effect.provide(memory.layer));
});

it.effect("writes records incrementally as the stream is consumed", () => {
  const memory = inMemoryFileSystem(StreamStore.StreamStore.layerParquet);
  const values = Array.from({ length: 2500 }, (_, index) => ({ index }));

  return Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;

    yield* store.save(Schema.Unknown)("many.parquet", Stream.fromIterable(values));

    assert.isAbove(memory.files.get("many.parquet")?.length ?? 0, 1);
    assert.deepStrictEqual(
      yield* Stream.runCollect(store.load(Schema.Unknown)("many.parquet")),
      values,
    );
  }).pipe(Effect.provide(memory.layer));
});

it.effect("saves and loads an empty parquet stream", () => {
  const memory = inMemoryFileSystem(StreamStore.StreamStore.layerParquet);

  return Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;

    yield* store.save(Schema.String)("empty.parquet", Stream.empty);

    assert.deepStrictEqual(
      yield* Stream.runCollect(store.load(Schema.String)("empty.parquet")),
      [],
    );
  }).pipe(Effect.provide(memory.layer));
});

it.effect("classifies parquet write failures as SaveFailed", () =>
  Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;

    const error = yield* store
      .save(Schema.String)("unwritable.parquet", Stream.make("value"))
      .pipe(Effect.flip);

    assert.instanceOf(error, StreamStore.SaveFailed);
    assert.strictEqual(error._tag, "SaveFailed");
  }).pipe(
    Effect.provide(
      provideFileStore(StreamStore.StreamStore.layerParquet, FileSystem.layerNoop({})),
    ),
  ),
);

it.effect("classifies parquet read failures as LoadFailed", () =>
  Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;

    const error = yield* Stream.runCollect(store.load(Schema.String)("missing.parquet")).pipe(
      Effect.flip,
    );

    assert.instanceOf(error, StreamStore.LoadFailed);
    assert.strictEqual(error._tag, "LoadFailed");
  }).pipe(
    Effect.provide(
      provideFileStore(
        StreamStore.StreamStore.layerParquet,
        FileSystem.layerNoop({
          sink: () => Sink.forEach(() => Effect.void),
          stream: () => Stream.empty,
        }),
      ),
    ),
  ),
);
