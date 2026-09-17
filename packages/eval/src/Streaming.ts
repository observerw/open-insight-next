import {
  Prompt,
  Trajectory,
  type Harness,
  type Sandbox,
  Response,
  Metrickit,
  StreamStore,
  Metric,
} from "@open-insight/core";
import {
  Cause,
  Effect,
  Match,
  Option,
  Queue,
  Ref,
  Semaphore,
  Stream,
  Deferred,
  Fiber,
} from "effect";
import * as Eval from "#/Eval.ts";
import * as Event from "#/Event.ts";
import * as Task from "#/Task.ts";
import * as Grade from "#/Grade.ts";
import { Toolkit } from "effect/unstable/ai";
import { ensureTrailCache } from "./internal/eval.ts";

export type EvalError =
  | Harness.HarnessError
  | Trajectory.TrajectoryError
  | Grade.GradeError
  | Metric.MetricError
  | StreamStore.StreamStoreError;

const makeSessionStream = ({
  promptSession,
  agentSession,
  sandbox,
}: {
  agentSession: Harness.AgentSession;
  promptSession: Prompt.Session;
  sandbox: Sandbox.Sandbox;
}) =>
  Stream.callback<Trajectory.AllSessionPart<any>, EvalError>(
    Effect.fn(function* (queue) {
      let current: Option.Option<Prompt.Prompt> = Option.some(promptSession.init);

      while (Option.isSome(current)) {
        const prompt = current.value;
        yield* Queue.offer(queue, prompt);

        const trajectory = yield* Deferred.make<Prompt.Prompt>();
        yield* agentSession
          .prompt(prompt)
          .pipe(
            Stream.onEnd(
              Ref.get(agentSession.trajectory).pipe(
                Effect.flatMap((prompt) => Deferred.succeed(trajectory, prompt)),
              ),
            ),
          )
          .pipe(Stream.runForEach((part) => Queue.offer(queue, part)));

        current = yield* Deferred.await(trajectory).pipe(
          Effect.flatMap((prompt) => promptSession.next(prompt, sandbox)),
        );
      }
    }),
  );

type SessionOptions = Readonly<{
  id: Event.SessionID;
  sessionStream: Stream.Stream<Trajectory.AllSessionPart<any>, EvalError>;
}>;
const makeSession = Effect.fn(function* ({ id, sessionStream }: SessionOptions) {
  const finishPartRef = yield* Ref.make<Option.Option<Response.FinishPart>>(Option.none());

  const startEvent = Stream.succeed(Event.SessionStartEvent.make({ id }));
  const sessionEvents = sessionStream.pipe(
    Stream.tap(
      Effect.fn(function* (part) {
        if ("type" in part && part.type === "finish") {
          yield* Ref.set(finishPartRef, Option.some(part));
        }
      }),
    ),
    Stream.map((part) =>
      Match.value(part).pipe(
        Match.when(Prompt.isPrompt, (prompt) => Event.SessionPromptEvent.make({ id, prompt })),
        Match.orElse((part) => Event.SessionStreamEvent.make({ id, part })),
      ),
    ),
  );

  const endEvent = Ref.get(finishPartRef).pipe(
    Effect.map(
      Option.match({
        onSome: ({ reason, usage }) => Event.SessionEndEvent.make({ id, reason, usage }),
        onNone: () => Event.SessionEndEvent.make({ id, reason: null, usage: null }),
      }),
    ),
    Stream.fromEffect,
  );

  return Stream.empty.pipe(
    Stream.concat(startEvent),
    Stream.concat(sessionEvents),
    Stream.concat(endEvent),
  );
}, Stream.unwrap);

type TrailOptions = Readonly<{
  id: Event.TrailID;
  harness: Harness.Any;
  task: Task.Any;
  grader: Grade.Grader<any>;
}>;
const makeTrail = Effect.fn(function* ({ id, task, harness, grader }: TrailOptions) {
  const store = yield* StreamStore.StreamStore;
  const trailCache = yield* ensureTrailCache(id);
  if (trailCache.exists) {
    return store.load(Event.TrailEvent)(trailCache.file);
  }

  const { resources, prompt: promptSession, snapshot, metrickit } = task;

  const sbxSession = yield* harness.runSandbox(snapshot, { resources });
  const sandbox = sbxSession.sandbox;
  const gradeSession = yield* grader.runSession(sandbox);
  const agentSession = yield* sbxSession.runAgent();

  const trajectoryQueue = yield* Queue.make<Trajectory.Any, Cause.Done>();
  const trajectories = Stream.fromQueue(trajectoryQueue);

  const metricResults = yield* Metrickit.run(metrickit, { trajectories, sandbox });
  const metricEvents = metricResults.pipe(
    Stream.map((result) => Event.MetricEvent.make({ id, metricID: result.id, result })),
  );

  const makeAttempt = ({
    promptSession,
    agentSession,
    sessionIdx,
  }: Readonly<{
    promptSession: Prompt.Session;
    agentSession: Harness.AgentSession;
    sessionIdx: number;
  }>) =>
    Effect.gen(function* () {
      const sessionID: Event.SessionID = { ...id, sessionIdx };

      const sessionStream = yield* makeSessionStream({ agentSession, promptSession, sandbox }).pipe(
        Stream.share({ capacity: "unbounded" }),
      );
      const sessionEvents = makeSession({ id: sessionID, sessionStream });
      const trajectory = Trajectory.fromSession(sessionStream, Toolkit.empty);

      yield* Queue.offer(trajectoryQueue, trajectory);

      const makeRetry = (
        retry: Grade.Retry,
      ): Stream.Stream<
        Event.TrailSuccessEvent,
        Event.TrailFailedEvent | EvalError,
        StreamStore.StreamStore
      > =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `Grader requested a "${retry.type}" retry for trail ${id.trailIdx}: ${retry.reason ?? "unknown reason"}`,
          );

          const nextSession = yield* Match.value(retry.type).pipe(
            Match.when("restart", () => sbxSession.runAgent()),
            Match.when("continue", () => Effect.succeed(agentSession)),
            Match.exhaustive,
          );
          const nextAttempt = makeAttempt({
            promptSession,
            agentSession: nextSession,
            sessionIdx: sessionIdx + 1,
          });
          const retryEvent = Stream.succeed(
            Event.SessionRetryEvent.make({ id: sessionID, reason: retry.reason }),
          );

          return Stream.empty.pipe(Stream.concat(retryEvent), Stream.concat(nextAttempt));
        }).pipe(Stream.unwrap);

      const endEvents = Effect.gen(function* () {
        const grade = yield* gradeSession;
        const endEvent = Stream.succeed(Event.TrailEndEvent.make({ id, grade }));
        return Stream.empty.pipe(Stream.concat(endEvent));
      }).pipe(Stream.unwrap, Stream.catchTag("Retry", makeRetry));

      return Stream.empty.pipe(Stream.concat(sessionEvents), Stream.concat(endEvents));
    }).pipe(Stream.unwrap);

  const startEvent = Stream.succeed(Event.TrailStartEvent.make({ id }));
  const attemptEvents = makeAttempt({ promptSession, agentSession, sessionIdx: 0 });

  const [stream, streamForCaching] = yield* Stream.empty
    .pipe(Stream.concat(startEvent), Stream.concat(attemptEvents), Stream.merge(metricEvents))
    .pipe(Stream.broadcastN({ n: 2, capacity: "unbounded" }));

  const cacheFiber = yield* store
    .save(Event.TrailSuccessEvent)(trailCache.file, streamForCaching)
    .pipe(Effect.forkScoped);

  return stream.pipe(Stream.onEnd(Fiber.join(cacheFiber)));
}, Stream.unwrap);

type TaskOptions = Readonly<{
  id: Event.TaskID;

  task: Task.Any;
  harness: Harness.Any;

  snapSem: Semaphore.Semaphore;
  trailSem: Semaphore.Semaphore;
  trailCount: number;
}>;
const makeTask = Effect.fn(function* ({
  id,
  task,
  harness,
  snapSem,
  trailSem,
  trailCount,
}: TaskOptions) {
  const { grader: gradeTemplate } = task;

  const grader = yield* Grade.run(gradeTemplate);

  const trailResultQueue = yield* Queue.make<Task.TrailResult<any>, Cause.Done>();

  const startEvent = Stream.succeed(
    Event.TaskStartEvent.make({
      id,
      task: task.metadata,
      // TODO
      extra: Option.some({}),
    }),
  );

  const trailSchedMutex = yield* Semaphore.make(1);
});

type EvalOptions = Readonly<{
  eval_: Eval.Any;
  config?: Partial<Eval.Config>;
}>;
export const make = Effect.fn(function* ({ eval_, config: configOptions }: EvalOptions) {});
