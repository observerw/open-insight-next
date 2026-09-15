import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import * as Response from "#/Response.ts";
import { fold } from "#/internal/fold.ts";

const collect = (
  parts: ReadonlyArray<Response.AllPartsView<{}>>,
): Effect.Effect<Array<Response.PartView<{}>>> =>
  fold(Stream.fromIterable(parts)).pipe(
    Stream.runCollect,
    Effect.map((output) => Array.from(output)),
  );

it.effect("folds interleaved text and reasoning streams", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      Response.makePart("text-start", {
        id: "text-1",
        metadata: { provider: { start: true, shared: "start" } },
      }),
      Response.makePart("reasoning-start", { id: "reasoning-1" }),
      Response.makePart("text-delta", {
        id: "text-1",
        delta: "hello ",
        metadata: { provider: { delta: 1, shared: "delta" } },
      }),
      Response.makePart("reasoning-delta", { id: "reasoning-1", delta: "think" }),
      Response.makePart("text-delta", { id: "text-1", delta: "world" }),
      Response.makePart("reasoning-end", { id: "reasoning-1" }),
      Response.makePart("text-end", {
        id: "text-1",
        metadata: { provider: { end: true } },
      }),
    ]);

    assert.deepStrictEqual(
      parts.map((part) =>
        part.type === "text" || part.type === "reasoning"
          ? { type: part.type, text: part.text }
          : { type: part.type },
      ),
      [
        { type: "reasoning", text: "think" },
        { type: "text", text: "hello world" },
      ],
    );
    assert.deepStrictEqual(parts[1]?.metadata, {
      provider: { start: true, delta: 1, shared: "delta", end: true },
    });
  }),
);

it.effect("tracks concurrent streams of the same kind by id", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      Response.makePart("text-start", { id: "one" }),
      Response.makePart("text-start", { id: "two" }),
      Response.makePart("text-delta", { id: "two", delta: "second" }),
      Response.makePart("text-delta", { id: "one", delta: "first" }),
      Response.makePart("text-end", { id: "one" }),
      Response.makePart("text-end", { id: "two" }),
    ]);

    assert.deepStrictEqual(
      parts.map((part) => (part.type === "text" ? part.text : part.type)),
      ["first", "second"],
    );
  }),
);

it.effect("passes completed parts through unchanged", () =>
  Effect.gen(function* () {
    const text = Response.makePart("text", { text: "complete" });

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

    const parts = yield* collect([text, finish]);

    assert.strictEqual(parts[0], text);
    assert.strictEqual(parts[1], finish);
  }),
);

it.effect("ignores incomplete streaming parts", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      Response.makePart("text-delta", { id: "missing", delta: "ignored" }),
      Response.makePart("reasoning-end", { id: "missing" }),
      Response.makePart("tool-params-start", {
        id: "tool-1",
        name: "unknown-tool",
        providerExecuted: false,
      }),
      Response.makePart("tool-params-delta", { id: "tool-1", delta: "{}" }),
      Response.makePart("tool-params-end", { id: "tool-1" }),
      Response.makePart("error", { error: "ignored" }),
    ]);

    assert.deepStrictEqual(parts, []);
  }),
);
