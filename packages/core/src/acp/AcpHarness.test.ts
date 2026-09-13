import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { assert, it } from "@effect/vitest";
import { Cause, Effect, Option, Stream } from "effect";
import { transform } from "./AcpHarness.ts";
import * as Response from "#/response/index.ts";

const collect = (
  updates: ReadonlyArray<SessionUpdate>,
): Effect.Effect<Array<Response.StreamPartView<{}>>, never, never> =>
  Stream.fromIterable(updates).pipe(
    transform,
    Stream.runCollect,
    Effect.map((parts) => Array.from(parts)),
  );

const textChunk = (text: string, messageId = "message-1"): SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  messageId,
  content: {
    type: "text",
    text,
  },
});

const thoughtChunk = (text: string, messageId = "thought-1"): SessionUpdate => ({
  sessionUpdate: "agent_thought_chunk",
  messageId,
  content: {
    type: "text",
    text,
  },
});

const anonymousTextChunk = (text: string): SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  content: {
    type: "text",
    text,
  },
});

it.effect("maps agent text chunks to text stream parts and finish", () =>
  Effect.gen(function* () {
    const parts = yield* collect([textChunk("hello "), textChunk("world")]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["text-start", "text-delta", "text-delta", "text-end", "finish"],
    );
    assert.strictEqual(parts[0]?.type === "text-start" && parts[0].id, "message-1");
    assert.strictEqual(parts[1]?.type === "text-delta" && parts[1].delta, "hello ");
    assert.strictEqual(parts[2]?.type === "text-delta" && parts[2].delta, "world");
  }),
);

it.effect("maps thought chunks to reasoning stream parts", () =>
  Effect.gen(function* () {
    const parts = yield* collect([thoughtChunk("thinking")]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["reasoning-start", "reasoning-delta", "reasoning-end", "finish"],
    );
    assert.strictEqual(parts[1]?.type === "reasoning-delta" && parts[1].delta, "thinking");
  }),
);

it.effect("keeps consecutive chunks without message ids in one segment", () =>
  Effect.gen(function* () {
    const parts = yield* collect([anonymousTextChunk("hello "), anonymousTextChunk("world")]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["text-start", "text-delta", "text-delta", "text-end", "finish"],
    );
    assert.strictEqual(parts[0]?.type === "text-start" && parts[0].id, "acp-agent-message-1");
    assert.strictEqual(parts[1]?.type === "text-delta" && parts[1].id, "acp-agent-message-1");
    assert.strictEqual(parts[2]?.type === "text-delta" && parts[2].id, "acp-agent-message-1");
  }),
);

it.effect("closes the active message when message id changes", () =>
  Effect.gen(function* () {
    const parts = yield* collect([textChunk("one", "one"), textChunk("two", "two")]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["text-start", "text-delta", "text-end", "text-start", "text-delta", "text-end", "finish"],
    );
    assert.strictEqual(parts[2]?.type === "text-end" && parts[2].id, "one");
    assert.strictEqual(parts[3]?.type === "text-start" && parts[3].id, "two");
  }),
);

it.effect("starts a new segment when a previous message id reappears", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      textChunk("first", "one"),
      textChunk("second", "two"),
      textChunk("third", "one"),
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      [
        "text-start",
        "text-delta",
        "text-end",
        "text-start",
        "text-delta",
        "text-end",
        "text-start",
        "text-delta",
        "text-end",
        "finish",
      ],
    );
    assert.deepStrictEqual(
      parts.flatMap((part) => (part.type === "text-start" ? [part.id] : [])),
      ["one", "two", "one"],
    );
  }),
);

it.effect("maps tool events to real tool-call and tool-result parts", () =>
  Effect.gen(function* () {
    const updates: ReadonlyArray<SessionUpdate> = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Read file",
        name: "filesystem_read",
        kind: "read",
        status: "in_progress",
        rawInput: {
          path: "README.md",
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: {
          ok: true,
        },
      },
    ];

    const parts = yield* collect(updates);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["tool-call", "tool-result", "finish"],
    );
    assert.strictEqual(parts[0]?.type === "tool-call" && parts[0].id, "tool-1");
    assert.strictEqual(parts[0]?.type === "tool-call" && parts[0].name, "filesystem_read");
    assert.isTrue(Response.isAnyToolCallPart(parts[0]));
    assert.strictEqual(parts[1]?.type === "tool-result" && parts[1].id, "tool-1");
    assert.isTrue(Response.isAnyToolResultPart(parts[1]));
    assert.strictEqual(parts[1]?.type === "tool-result" && parts[1].name, "filesystem_read");
    assert.strictEqual(parts[1]?.type === "tool-result" && parts[1].isFailure, false);
    assert.strictEqual(parts[1]?.type === "tool-result" && parts[1].preliminary, false);
  }),
);

it.effect("tracks a programmatic name first seen in a tool update", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-rename",
        name: "shell_execute",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-rename",
        status: "completed",
      },
    ]);

    assert.deepStrictEqual(
      parts.flatMap((part) => (part.type === "tool-result" ? [part.name] : [])),
      ["shell_execute", "shell_execute"],
    );
  }),
);

it.effect("maps in-progress tool updates to preliminary tool results", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-2",
        status: "in_progress",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "working",
            },
          },
        ],
      },
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["tool-result", "finish"],
    );
    assert.strictEqual(parts[0]?.type === "tool-result" && parts[0].preliminary, true);
    assert.strictEqual(parts[0]?.type === "tool-result" && parts[0].name, "acp_tool_tool_2");
  }),
);

it.effect("keeps dynamic tool payloads JSON-safe instead of defecting on unsupported values", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-non-json",
        title: "Non JSON input",
        rawInput: BigInt(1),
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-non-json",
        status: "completed",
        rawOutput: BigInt(2),
      },
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["tool-call", "tool-result", "finish"],
    );
    const toolCall = parts[0];
    const toolResult = parts[1];
    assert.deepStrictEqual(toolCall?.type === "tool-call" ? toolCall.params : undefined, {
      omitted: true,
    });
    assert.deepStrictEqual(toolResult?.type === "tool-result" ? toolResult.result : undefined, {
      omitted: true,
    });
    assert.deepStrictEqual(toolCall?.type === "tool-call" ? toolCall.metadata?.acp : undefined, {
      sessionUpdate: "tool_call",
      toolCallId: "tool-non-json",
      title: "Non JSON input",
      rawInput: { omitted: true },
    });
  }),
);

it.effect("keeps plan and session state events as metadata", () =>
  Effect.gen(function* () {
    const updates: ReadonlyArray<SessionUpdate> = [
      {
        sessionUpdate: "plan",
        entries: [
          {
            content: "Implement",
            priority: "high",
            status: "in_progress",
          },
        ],
      },
      {
        sessionUpdate: "current_mode_update",
        currentModeId: "code",
      },
      {
        sessionUpdate: "session_info_update",
        title: "Session",
      },
    ];

    const parts = yield* collect(updates);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["response-metadata", "response-metadata", "response-metadata", "finish"],
    );
  }),
);

it.effect("uses the latest usage update when the stream finishes", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      textChunk("before "),
      {
        sessionUpdate: "usage_update",
        used: 42,
        size: 100,
      },
      textChunk("after"),
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["text-start", "text-delta", "text-delta", "text-end", "finish"],
    );
    const finish = parts.find((part) => part.type === "finish");
    assert.strictEqual(finish?.type === "finish" && finish.usage.inputTokens.total, 42);
  }),
);

it.effect("preserves upstream errors without emitting successful completion", () =>
  Effect.gen(function* () {
    const error = "boom";
    const observed: Array<Response.StreamPartView<{}>> = [];
    const result = yield* Stream.make(textChunk("partial")).pipe(
      Stream.concat(Stream.fail(error)),
      transform,
      Stream.tap((part) =>
        Effect.sync(() => {
          observed.push(part);
        }),
      ),
      Stream.runDrain,
      Effect.exit,
    );

    assert.deepStrictEqual(
      observed.map((part) => part.type),
      ["text-start", "text-delta"],
    );
    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure") {
      assert.deepStrictEqual(Cause.findErrorOption(result.cause), Option.some(error));
    }
  }),
);
