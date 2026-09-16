import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema, Sink, Stream } from "effect";
import * as StreamStore from "#/StreamStore.ts";

const provideFileStore = (fileSystem: Layer.Layer<FileSystem.FileSystem>) =>
  StreamStore.StreamStore.layer.pipe(Layer.provide(fileSystem));

const inMemoryFileSystem = () => {
  const files = new Map<string, Array<Uint8Array>>();

  const layer = provideFileStore(
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
  const memory = inMemoryFileSystem();
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
  const memory = inMemoryFileSystem();
  memory.files.set("values.ndjson", [new TextEncoder().encode("1\n\n2\n")]);

  return Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;
    const values = yield* Stream.runCollect(store.load(Schema.Number)("values.ndjson"));

    assert.deepStrictEqual(values, [1, 2]);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("loads records with offset and limit", () => {
  const memory = inMemoryFileSystem();
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
  }).pipe(Effect.provide(provideFileStore(FileSystem.layerNoop({})))),
);

it.effect("classifies file-system read failures as LoadFailed", () =>
  Effect.gen(function* () {
    const store = yield* StreamStore.StreamStore;

    const error = yield* Stream.runCollect(store.load(Schema.String)("missing.ndjson")).pipe(
      Effect.flip,
    );

    assert.instanceOf(error, StreamStore.LoadFailed);
    assert.strictEqual(error._tag, "LoadFailed");
  }).pipe(Effect.provide(provideFileStore(FileSystem.layerNoop({})))),
);
