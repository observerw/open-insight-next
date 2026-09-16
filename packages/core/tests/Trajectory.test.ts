import { assert, it } from "@effect/vitest";
import { Effect, Match, Predicate, Schema, Sink, Stream } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import * as NdjsonStore from "#/StreamStore.ts";
import * as Prompt from "#/Prompt.ts";
import * as Response from "#/Response.ts";
import * as ToolkitData from "#/Toolkit.ts";
import * as Trajectory from "#/Trajectory.ts";

it.effect("groups trajectory parts into session turns", () =>
  Effect.gen(function* () {
    const firstPrompt = Prompt.make("first");
    const secondPrompt = Prompt.make("second");
    const firstResponse = Response.makePart("text", { text: "answer" });

    const trajectory = Stream.fromIterable<Trajectory.AnyPart>([
      Trajectory.responsePart(Response.makePart("text", { text: "orphan" })),
      Trajectory.promptPart(firstPrompt),
      Trajectory.responsePart(firstResponse),
      Trajectory.promptPart(secondPrompt),
    ]);

    const turns = yield* Trajectory.toSession(trajectory).pipe(
      Stream.runCollect,
      Effect.map((turns) => Array.from(turns)),
    );

    assert.strictEqual(turns.length, 2);
    assert.deepStrictEqual(turns[0]?.prompt.content, firstPrompt.content);
    assert.deepStrictEqual(turns[0]?.response, [firstResponse]);
    assert.deepStrictEqual(turns[1]?.prompt.content, secondPrompt.content);
    assert.deepStrictEqual(turns[1]?.response, []);
  }),
);

it.effect("preserves trajectory failures while grouping session turns", () =>
  Effect.gen(function* () {
    const error = Trajectory.TrajectoryError.streaming(new Error("trajectory failed"));

    const trajectory = Stream.succeed<Trajectory.AnyPart>(
      Trajectory.promptPart(Prompt.make("prompt")),
    ).pipe(Stream.concat(Stream.fail(error)));

    const observed = yield* Trajectory.toSession(trajectory).pipe(Stream.runDrain, Effect.flip);

    assert.strictEqual(observed, error);
  }),
);

it.effect("creates ordered trajectory parts and folds streamed responses", () =>
  Effect.gen(function* () {
    const firstPrompt = Prompt.make("first");
    const secondPrompt = Prompt.make("second");

    const finish = Response.makePart("finish", {
      reason: "stop",
      usage: {
        inputTokens: {
          total: 0,
          uncached: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 0, text: undefined, reasoning: undefined },
      },
    });

    const session: Trajectory.SessionStream<{}> = Stream.make(
      firstPrompt,
      Response.makePart("text-start", { id: "text-1" }),
      Response.makePart("text-delta", { id: "text-1", delta: "hello " }),
      Response.makePart("text-delta", { id: "text-1", delta: "world" }),
      Response.makePart("text-end", { id: "text-1" }),
      finish,
      secondPrompt,
      Response.makePart("text", { text: "done" }),
    );

    const parts = yield* Trajectory.fromStreamSession(session, Toolkit.empty).pipe(
      Stream.runCollect,
      Effect.map((parts) => Array.from(parts)),
    );

    assert.deepStrictEqual(
      parts.map((part) =>
        Match.value(part).pipe(
          Match.tag("Prompt", (prompt) => ({ tag: prompt._tag, messages: prompt.messages })),
          Match.tag("Response", (response) =>
            response.response.type === "text"
              ? { tag: response._tag, type: response.response.type, text: response.response.text }
              : { tag: response._tag, type: response.response.type },
          ),
          Match.exhaustive,
        ),
      ),
      [
        { tag: "Prompt", messages: firstPrompt.content },
        { tag: "Response", type: "text", text: "hello world" },
        { tag: "Response", type: "finish" },
        { tag: "Prompt", messages: secondPrompt.content },
        { tag: "Response", type: "text", text: "done" },
      ],
    );
  }),
);

it.effect("preserves session failures while folding streamed parts", () =>
  Effect.gen(function* () {
    const cause = new Error("response failed");
    const error = Trajectory.TrajectoryError.streaming(cause);
    const observed: Array<Trajectory.AnyPart> = [];

    const session: Trajectory.SessionStream<{}> = Stream.make(Prompt.make("prompt")).pipe(
      Stream.concat(Stream.fail(error)),
    );

    const failure = yield* Trajectory.fromStreamSession(session, Toolkit.empty).pipe(
      Stream.tap((part) =>
        Effect.sync(() => {
          observed.push(part);
        }),
      ),
      Stream.runDrain,
      Effect.flip,
    );

    assert.strictEqual(observed.length, 1);
    assert.strictEqual(observed[0]?._tag, "Prompt");
    assert.strictEqual(failure, error);

    if (Predicate.isTagged("StreamingError")(failure.reason)) {
      assert.strictEqual(failure.reason.cause, cause);
      assert.strictEqual(failure.message, cause.message);
    }
  }),
);

it("carries the toolkit and metadata of the trajectory", () => {
  const toolkit = Toolkit.empty;

  const trajectory = Trajectory.fromStreamSession(Stream.empty, toolkit, { name: "session" });

  assert.strictEqual(trajectory.toolkit, toolkit);
  assert.strictEqual(trajectory.metadata.name, "session");
});

const NumberTool = Tool.make("number", {
  parameters: Schema.Struct({ value: Schema.NumberFromString }),
  success: Schema.NumberFromString,
});

const numberToolkit = Toolkit.make(NumberTool);

it.effect("pairs tool calls with their final results", () =>
  Effect.gen(function* () {
    const responsePartSchema = Trajectory.ResponsePart(numberToolkit);

    const callOne = Response.toolCallPart({
      id: "call-1",
      name: "number",
      params: { value: 1 },
      providerExecuted: false,
    });

    const callTwo = Response.toolCallPart({
      id: "call-2",
      name: "number",
      params: { value: 2 },
      providerExecuted: false,
    });

    const resultOne = Response.toolResultPart({
      id: "call-1",
      name: "number",
      isFailure: false,
      result: 1,
      encodedResult: "1",
      providerExecuted: false,
      preliminary: false,
    });

    const preliminaryOne = Response.toolResultPart({
      ...resultOne,
      result: 0,
      encodedResult: "0",
      preliminary: true,
    });

    const resultTwo = Response.toolResultPart({
      id: "call-2",
      name: "number",
      isFailure: false,
      result: 2,
      encodedResult: "2",
      providerExecuted: false,
      preliminary: false,
    });

    const orphanResult = Response.toolResultPart({
      ...resultOne,
      id: "orphan",
    });

    const trajectory = Trajectory.make(
      Stream.make(
        responsePartSchema.make({ response: callOne }),
        responsePartSchema.make({ response: callTwo }),
        responsePartSchema.make({ response: Response.makePart("text", { text: "ignored" }) }),
        responsePartSchema.make({ response: resultTwo }),
        responsePartSchema.make({ response: preliminaryOne }),
        responsePartSchema.make({ response: resultOne }),
        responsePartSchema.make({ response: orphanResult }),
      ),
      numberToolkit,
    );

    const turns = yield* Trajectory.toolTurns(trajectory).pipe(
      Stream.runCollect,
      Effect.map((turns) => Array.from(turns)),
    );

    assert.deepStrictEqual(turns, [
      { call: callTwo, result: resultTwo },
      { call: callOne, result: resultOne },
    ]);
  }),
);

it.effect("preserves trajectory failures while pairing tool turns", () =>
  Effect.gen(function* () {
    const cause = new Error("trajectory failed");
    const trajectory = Trajectory.make(Stream.fail(cause), numberToolkit);

    const observed = yield* Trajectory.toolTurns(trajectory).pipe(Stream.runDrain, Effect.flip);

    assert.strictEqual(observed.reason._tag, "StreamingError");

    if (Predicate.isTagged("StreamingError")(observed.reason)) {
      assert.strictEqual(observed.reason.cause, cause);
    }
  }),
);

it.effect("adds toolkits and decodes previously unknown tool parts", () =>
  Effect.gen(function* () {
    const promptPart = Trajectory.PromptPart.make({
      messages: Prompt.make("prompt").content,
      session: "session-1",
      extra: { source: "test" },
    });

    const decodeUnknownResponse = Schema.decodeEffect(Response.PartView(Toolkit.empty));

    const callResponse = yield* decodeUnknownResponse({
      type: "tool-call",
      id: "call-1",
      name: "number",
      params: { value: "42" },
    });

    const resultResponse = yield* decodeUnknownResponse({
      type: "tool-result",
      id: "call-1",
      name: "number",
      isFailure: false,
      result: "42",
    });

    const callPart = Trajectory.AnyResponsePart.make({
      response: callResponse,
      session: "session-1",
      extra: { source: "test" },
    });

    const resultPart = Trajectory.AnyResponsePart.make({
      response: resultResponse,
      session: "session-1",
      extra: { source: "test" },
    });

    const trajectory = Trajectory.make(
      Stream.make(promptPart, callPart, resultPart),
      Toolkit.empty,
      { name: "trajectory" },
    );

    const extended = yield* trajectory.pipe(Trajectory.toolkits(numberToolkit));

    const parts = yield* extended.pipe(
      Stream.runCollect,
      Effect.map((parts) => Array.from(parts)),
    );

    assert.strictEqual(extended.metadata, trajectory.metadata);
    assert.deepStrictEqual(Object.keys(extended.toolkit.tools), ["number"]);
    assert.deepStrictEqual(parts[0], promptPart);

    const transformedCall = parts[1];
    assert.strictEqual(transformedCall?._tag, "Response");

    if (transformedCall?._tag === "Response") {
      assert.strictEqual(transformedCall.uuid, callPart.uuid);
      assert.strictEqual(transformedCall.timestamp, callPart.timestamp);
      assert.strictEqual(transformedCall.session, callPart.session);
      assert.deepStrictEqual(transformedCall.extra, callPart.extra);
      assert.isFalse(Response.isAnyToolCallPart(transformedCall.response));
      assert.strictEqual(transformedCall.response.type, "tool-call");

      if (transformedCall.response.type === "tool-call") {
        assert.deepStrictEqual(transformedCall.response.params, { value: 42 });
      }
    }

    const transformedResult = parts[2];
    assert.strictEqual(transformedResult?._tag, "Response");

    if (transformedResult?._tag === "Response") {
      assert.strictEqual(transformedResult.uuid, resultPart.uuid);
      assert.strictEqual(transformedResult.timestamp, resultPart.timestamp);
      assert.strictEqual(transformedResult.session, resultPart.session);
      assert.deepStrictEqual(transformedResult.extra, resultPart.extra);
      assert.isFalse(Response.isAnyToolResultPart(transformedResult.response));
      assert.strictEqual(transformedResult.response.type, "tool-result");

      if (transformedResult.response.type === "tool-result") {
        assert.strictEqual(transformedResult.response.result, 42);
        assert.strictEqual(transformedResult.response.encodedResult, "42");
      }
    }
  }),
);

it.effect("maps toolkit decoding failures to trajectory decode errors", () =>
  Effect.gen(function* () {
    const invalidResponse = yield* Schema.decodeEffect(Response.PartView(Toolkit.empty))({
      type: "tool-call",
      id: "call-1",
      name: "number",
      params: { value: {} },
    });

    const trajectory = Trajectory.make(
      Stream.succeed(Trajectory.responsePart(invalidResponse)),
      Toolkit.empty,
    );

    const error = yield* trajectory.pipe(
      Trajectory.toolkits(numberToolkit),
      Effect.flatMap(Stream.runDrain),
      Effect.flip,
    );

    assert.strictEqual(error.reason._tag, "DecodeError");
  }),
);

const memoryStore = () => {
  const files = new Map<string, Array<Uint8Array>>();

  return {
    files,
    layer: NdjsonStore.layerFromBackend({
      sink: (path) => {
        files.set(path, []);

        return Sink.forEach((chunk: Uint8Array) =>
          Effect.sync(() => {
            files.get(path)?.push(chunk.slice());
          }),
        );
      },
      stream: (path) => Stream.fromIterable(files.get(path) ?? []),
    }),
  };
};

it.effect(
  "persists metadata, toolkit, and encoded parts before returning a loaded trajectory",
  () => {
    const memory = memoryStore();

    return Effect.gen(function* () {
      const responsePartSchema = Trajectory.ResponsePart(numberToolkit);

      const prompt = Trajectory.PromptPart.make({
        messages: Prompt.make("persist me").content,
        session: "session-1",
      });

      const response = responsePartSchema.make({
        response: Response.makePart("text", { text: "stored response" }),
        session: "session-1",
      });

      const sourceParts = [prompt, response];

      const source = Trajectory.make(Stream.fromIterable(sourceParts), numberToolkit, {
        name: "persisted trajectory",
        description: "round trip",
      });

      const persisted = yield* source.pipe(Trajectory.persist("trajectory.ndjson"));

      assert.notStrictEqual(persisted, source);
      assert.strictEqual(persisted.toolkit, source.toolkit);
      assert.notStrictEqual(persisted.metadata, source.metadata);
      assert.deepStrictEqual(persisted.metadata, source.metadata);

      sourceParts.length = 0;

      const loadedParts = yield* persisted.pipe(
        Stream.runCollect,
        Effect.map((parts) => Array.from(parts)),
      );

      assert.deepStrictEqual(loadedParts, [prompt, response]);

      const bytes = memory.files.get("trajectory.ndjson") ?? [];

      const lines = new TextDecoder()
        .decode(Uint8Array.from(bytes.flatMap((chunk) => Array.from(chunk))))
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));

      const encodePart = Schema.encodeSync(Trajectory.Part(numberToolkit));

      assert.deepStrictEqual(lines, [
        { name: "persisted trajectory", description: "round trip" },
        ToolkitData.encode(numberToolkit),
        encodePart(prompt),
        encodePart(response),
      ]);
    }).pipe(Effect.provide(memory.layer));
  },
);

it("constructs, handles, and safely encodes persistence reasons", () => {
  const save = Trajectory.TrajectoryError.save("trajectory.ndjson");
  const load = Trajectory.TrajectoryError.load("trajectory.ndjson");

  assert.strictEqual(save.reason._tag, "SaveError");
  assert.strictEqual(load.reason._tag, "LoadError");
  assert.strictEqual(save.message, "Failed to save trajectory at trajectory.ndjson");
  assert.strictEqual(load.message, "Failed to load trajectory at trajectory.ndjson");
  assert.isFalse("cause" in save.reason);
  assert.isFalse(Object.hasOwn(save.reason, "message"));

  const handled = Effect.runSync(
    Effect.fail(save).pipe(
      Effect.catchReason("TrajectoryError", "SaveError", (reason) => Effect.succeed(reason.path)),
    ),
  );

  assert.strictEqual(handled, "trajectory.ndjson");

  const unmatched = Effect.runSync(
    Effect.fail(load).pipe(
      Effect.catchReason("TrajectoryError", "SaveError", () => Effect.void),
      Effect.flip,
    ),
  );

  assert.strictEqual(unmatched, load);

  const encoded = Schema.encodeSync(Trajectory.TrajectoryError)(save);

  assert.strictEqual(encoded._tag, "TrajectoryError");
  assert.strictEqual(encoded.reason._tag, "SaveError");
  assert.deepStrictEqual(Object.keys(encoded.reason).sort(), ["_tag", "path"]);

  if (Predicate.isTagged("SaveError")(encoded.reason)) {
    assert.strictEqual(encoded.reason.path, "trajectory.ndjson");
  }
});

it.effect("maps store writes to save errors", () =>
  Effect.gen(function* () {
    const cause = new Error("write failed");

    const layer = NdjsonStore.layerFromBackend({
      sink: () => Sink.fail(cause),
      stream: () => Stream.empty,
    });

    const trajectory = Trajectory.make(Stream.empty, Toolkit.empty);

    const error = yield* trajectory.pipe(
      Trajectory.persist("trajectory.ndjson"),
      Effect.provide(layer),
      Effect.flip,
    );

    assert.strictEqual(error.reason._tag, "SaveError");

    if (Predicate.isTagged("SaveError")(error.reason)) {
      assert.strictEqual(error.reason.path, "trajectory.ndjson");
    }
  }),
);

it.effect("maps invalid persisted headers to load errors", () => {
  const layer = NdjsonStore.layerFromBackend({
    sink: () => Sink.forEach(() => Effect.void),
    stream: () => Stream.succeed(new TextEncoder().encode("{}\n")),
  });

  const trajectory = Trajectory.make(Stream.empty, Toolkit.empty);

  return trajectory.pipe(
    Trajectory.persist("trajectory.ndjson"),
    Effect.provide(layer),
    Effect.flip,
    Effect.map((error) => {
      assert.strictEqual(error.reason._tag, "LoadError");

      if (Predicate.isTagged("LoadError")(error.reason)) {
        assert.strictEqual(error.reason.path, "trajectory.ndjson");
      }
    }),
  );
});

it.effect("maps persisted part reads to load errors", () => {
  const files = new Map<string, Array<Uint8Array>>();
  const cause = new Error("read failed");
  let reads = 0;

  const layer = NdjsonStore.layerFromBackend({
    sink: (path) => {
      files.set(path, []);

      return Sink.forEach((chunk: Uint8Array) =>
        Effect.sync(() => {
          files.get(path)?.push(chunk.slice());
        }),
      );
    },
    stream: (path) => {
      reads += 1;

      return reads === 1 ? Stream.fromIterable(files.get(path) ?? []) : Stream.fail(cause);
    },
  });

  return Effect.gen(function* () {
    const trajectory = Trajectory.make(
      Stream.succeed(Trajectory.promptPart(Prompt.make("persist me"))),
      Toolkit.empty,
    );

    const persisted = yield* trajectory.pipe(Trajectory.persist("trajectory.ndjson"));
    const error = yield* persisted.pipe(Stream.runDrain, Effect.flip);

    assert.strictEqual(error.reason._tag, "LoadError");

    if (Predicate.isTagged("LoadError")(error.reason)) {
      assert.strictEqual(error.reason.path, "trajectory.ndjson");
    }
  }).pipe(Effect.provide(layer));
});
