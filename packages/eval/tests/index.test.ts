import { assert, it } from "vite-plus/test";
import { Effect, Stream } from "effect";
import { Prompt, Response, Trajectory } from "@open-insight/core";
import * as Event from "#/Event.ts";
import * as Result from "#/Result.ts";

const trailID: Event.TrailID = { evalID: "eval", taskID: "task", trailIdx: 0 };

const sessionID = (sessionIdx: number): Event.SessionID => ({ ...trailID, sessionIdx });

const textPart = (sessionIdx: number, text: string) =>
  Event.SessionStreamEvent.make({
    id: sessionID(sessionIdx),
    part: Response.makePart("text", { text }),
  });

const collectTexts = (trajectory: Trajectory.Any) =>
  Trajectory.responses(trajectory).pipe(
    Stream.filter((part) => part.type === "text"),
    Stream.map((part) => part.text),
    Stream.runCollect,
    Effect.map((parts) => Array.from(parts)),
  );

const collectSessionTexts = (sessions: Stream.Stream<Trajectory.Any, Result.ResultError>) =>
  sessions.pipe(
    Stream.mapEffect(collectTexts),
    Stream.runCollect,
    Effect.map((parts) => Array.from(parts)),
    Effect.timeout("1 second"),
  );

const runSink = (events: ReadonlyArray<Event.TrailSuccessEvent>) =>
  Stream.fromIterable(events).pipe(Stream.run(Result.trailResultSink));

const twoSessions = [
  Event.TrailStartEvent.make({ id: trailID }),
  Event.SessionStartEvent.make({ id: sessionID(0) }),
  Event.SessionPromptEvent.make({ id: sessionID(0), prompt: Prompt.make("first") }),
  Event.SessionStreamEvent.make({
    id: sessionID(0),
    part: Response.makePart("text-start", { id: "text-1" }),
  }),
  Event.SessionStreamEvent.make({
    id: sessionID(0),
    part: Response.makePart("text-delta", { id: "text-1", delta: "hello " }),
  }),
  Event.SessionStreamEvent.make({
    id: sessionID(0),
    part: Response.makePart("text-delta", { id: "text-1", delta: "world" }),
  }),
  Event.SessionStreamEvent.make({
    id: sessionID(0),
    part: Response.makePart("text-end", { id: "text-1" }),
  }),
  Event.SessionEndEvent.make({ id: sessionID(0), usage: null, reason: null }),
  Event.SessionRetryEvent.make({ id: sessionID(0), reason: "grading failed" }),
  Event.SessionStartEvent.make({ id: sessionID(1) }),
  Event.SessionPromptEvent.make({ id: sessionID(1), prompt: Prompt.make("second") }),
  textPart(1, "done"),
  Event.SessionEndEvent.make({ id: sessionID(1), usage: null, reason: null }),
  Event.TrailEndEvent.make({ id: trailID, grade: { score: 1 } }),
];

it("sessions streams one trajectory per session", async () => {
  const texts = await Effect.runPromise(
    Stream.fromIterable(twoSessions).pipe(Result.sessions, collectSessionTexts),
  );

  assert.deepStrictEqual(texts, [["hello world"], ["done"]]);
});

it("sessions keeps streaming a session larger than the group buffer", async () => {
  const first = sessionID(0);
  const deltas = Array.from({ length: 5000 }, (_, index) => `chunk-${index};`);

  const texts = await Effect.runPromise(
    Stream.fromIterable([
      Event.SessionStartEvent.make({ id: first }),
      Event.SessionPromptEvent.make({ id: first, prompt: Prompt.make("first") }),
      ...deltas.map((delta, index) =>
        index === 0
          ? Event.SessionStreamEvent.make({
              id: first,
              part: Response.makePart("text-start", { id: "text-1" }),
            })
          : Event.SessionStreamEvent.make({
              id: first,
              part: Response.makePart("text-delta", { id: "text-1", delta }),
            }),
      ),
      Event.SessionStreamEvent.make({
        id: first,
        part: Response.makePart("text-end", { id: "text-1" }),
      }),
      Event.SessionEndEvent.make({ id: first, usage: null, reason: null }),
      Event.TrailEndEvent.make({ id: trailID, grade: "done" }),
    ]).pipe(Result.sessions, collectSessionTexts),
  );

  assert.deepStrictEqual(texts, [[deltas.slice(1).join("")]]);
});

it("sessions can be collected before their trajectories are consumed", async () => {
  const trajectories = Array.from(
    await Effect.runPromise(
      Stream.fromIterable(twoSessions).pipe(
        Result.sessions,
        Stream.runCollect,
        Effect.timeout("1 second"),
      ),
    ),
  );

  assert.strictEqual(trajectories.length, 2);

  assert.deepStrictEqual(
    await Promise.all(
      trajectories.map((trajectory) => Effect.runPromise(collectTexts(trajectory))),
    ),
    [["hello world"], ["done"]],
  );
});

it("trailResultSink rebuilds the grade and sessions of a trail", async () => {
  const result = await Effect.runPromise(runSink(twoSessions));

  assert.deepStrictEqual(result.grade, { score: 1 });
  assert.deepStrictEqual(await Effect.runPromise(collectSessionTexts(result.sessions)), [
    ["hello world"],
    ["done"],
  ]);
});

it("trailResultSink fails when the trail has no end event", async () => {
  const error = await Effect.runPromise(
    Stream.make(Event.TrailStartEvent.make({ id: trailID })).pipe(
      Stream.run(Result.trailResultSink),
      Effect.flip,
    ),
  );

  assert.strictEqual(error._tag, "ResultError");
});
