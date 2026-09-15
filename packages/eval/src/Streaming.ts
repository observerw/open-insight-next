import { Trajectory, type Harness, type Prompt, type Sandbox } from "@open-insight/core";
import {
  Cause,
  Effect,
  FileSystem,
  Match,
  Option,
  Path,
  Queue,
  Ref,
  Semaphore,
  Crypto,
  Stream,
  Array,
  Scope,
  flow,
  Deferred,
  Fiber,
} from "effect";
import * as Eval from "#/Eval.ts";
import * as Event from "#/Event.ts";
import * as Task from "#/Task.ts";

export type EvalError = Harness.HarnessError;

const makeStreamSession = Effect.fn(function* ({
  promptSession,
  agentSession,
  sandbox,
}: {
  agentSession: Harness.AgentSession;
  promptSession: Prompt.Session;
  sandbox: Sandbox.Sandbox;
}) {
  return Stream.callback<Trajectory.StreamSessionTurn<Record<string, never>, EvalError>>(
    Effect.fn(function* (queue) {
      let current: Option.Option<Prompt.Prompt> = Option.some(promptSession.init);

      while (Option.isSome(current)) {
        const prompt = current.value;
        const trajectory = yield* Deferred.make<Prompt.Prompt>();
        const response = agentSession
          .prompt(prompt)
          .pipe(
            Stream.onEnd(
              Ref.get(agentSession.trajectory).pipe(
                Effect.flatMap((prompt) => Deferred.succeed(trajectory, prompt)),
              ),
            ),
          );

        yield* Queue.offer(queue, { prompt, response });

        current = yield* Deferred.await(trajectory).pipe(
          Effect.flatMap((prompt) => promptSession.next(prompt, sandbox)),
        );
      }
    }),
  );
});

type SessionOptions = Readonly<{
  id: Event.SessionID;
  session: Trajectory.StreamSession<any, EvalError>;
}>;
const makeSession = Effect.fn(
  function* ({ id, session }: SessionOptions) {
    const shared = yield* session.pipe(Stream.share({ capacity: "unbounded" }));

    const startEvent = Stream.succeed(Event.SessionStartEvent.make({ id }));
    const sessionEvents = shared.pipe(
      Stream.map((part) =>
        Match.value(part).pipe(
          Match.tag("Prompt", (prompt) => Event.SessionPromptEvent.make({ id, prompt })),
          Match.tag("Response", ({ response }) =>
            Event.SessionStreamEvent.make({ id, part: response }),
          ),
          Match.exhaustive,
        ),
      ),
    );

    const endEvent = Stream.run(shared, Trajectory.finishPart).pipe(
      Effect.map(
        Option.match({
          onSome: ({ reason, usage }) => Event.SessionEndEvent.make({ id, reason, usage }),
          onNone: () => Event.SessionEndEvent.make({ id, reason: null, usage: null }),
        }),
      ),
      Stream.fromEffect,
    );

    const result = Stream.fail(new Task.SessionResult({ trajectory }));

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(sessionEvents),
      Stream.concat(endEvent),
      Stream.concat(result),
    );
  },
  (eff, { id }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(Event.SessionErrorEvent.make({ id, error })),
      ),
    ),
);

type TrailOptions = Readonly<{
  id: Event.TrailID;
  harness: Harness.Any;
  task: Task.Any;
}>;
const makeTrail = Effect.fn(function* ({ id, task, harness }: TrailOptions) {
  const { resources, prompt, snapshot } = task;

  const sbxSession = yield* harness.runSandbox(snapshot, { resources });
  const sandbox = sbxSession.sandbox;

  const sessionQueue = yield* Queue.make<Trajectory.Any, Cause.Done>();
  const sessions = Stream.fromQueue(sessionQueue);

  const sessionResultQueue = yield* Queue.make<Task.SessionResult, Cause.Done>();
});

type TaskOptions = Readonly<{
  id: Event.TaskID;

  task: Task.Any;
  harness: Harness.Any;

  snapSem: Semaphore.Semaphore;
  trailSem: Semaphore.Semaphore;
  trailCount: number;
}>;
const makeTask = Effect.fn(function* (options: TaskOptions) {});

type EvalOptions = Readonly<{
  eval_: Eval.Any;
  config?: Partial<Eval.Config>;
}>;
export const make = Effect.fn(function* ({ eval_, config: configOptions }: EvalOptions) {});
