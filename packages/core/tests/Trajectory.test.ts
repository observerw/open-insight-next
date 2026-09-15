import { assert, it } from "@effect/vitest";
import { Effect, Match, Predicate, Schema, Stream } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import * as Prompt from "#/Prompt.ts";
import * as Response from "#/Response.ts";
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
    const error = Trajectory.TrajectoryError.partStream(new Error("trajectory failed"));

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

    const session = Stream.make(
      {
        prompt: firstPrompt,
        response: Stream.make(
          Response.makePart("text-start", { id: "text-1" }),
          Response.makePart("text-delta", { id: "text-1", delta: "hello " }),
          Response.makePart("text-delta", { id: "text-1", delta: "world" }),
          Response.makePart("text-end", { id: "text-1" }),
          finish,
        ),
      },
      {
        prompt: secondPrompt,
        response: Stream.make(Response.makePart("text", { text: "done" })),
      },
    );

    const parts = yield* Trajectory.fromSession(session, Toolkit.empty).pipe(
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

it.effect("maps response stream failures to trajectory streaming errors", () =>
  Effect.gen(function* () {
    const cause = new Error("response failed");
    const observed: Array<Trajectory.AnyPart> = [];

    const session = Stream.succeed({
      prompt: Prompt.make("prompt"),
      response: Stream.fail(cause),
    });

    const error = yield* Trajectory.fromSession(session, Toolkit.empty).pipe(
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
    assert.strictEqual(error.reason._tag, "StreamingError");

    if (Predicate.isTagged("StreamingError")(error.reason)) {
      assert.strictEqual(error.reason.cause, cause);
      assert.strictEqual(error.message, cause.message);
    }
  }),
);

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
