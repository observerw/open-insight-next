import { Trajectory, Toolkit } from "@open-insight/core";
import { Data, Effect, Match, Result, Schema, Stream } from "effect";
import * as Event from "#/Event.ts";

export class ResultError extends Data.TaggedError("ResultError")<{
  readonly cause: unknown;
}> {}

export type TrailResult<G extends Schema.Constraint> = Readonly<{
  grade: G["Type"];
  sessions: Stream.Stream<Trajectory.Any, ResultError>;
}>;

/**
 * Checks whether an event ends the session it belongs to.
 */
const isSessionEndEvent = Schema.is(Event.SessionEndEvent);

/**
 * Recovers the trajectory part recorded by a session event.
 *
 * **Details**
 *
 * Session events that do not record a part, such as session starts, retries
 * and ends, are discarded.
 */
const sessionPart = (
  event: Event.SessionSuccessEvent,
): Result.Result<Trajectory.AllSessionPart<{}>, void> =>
  Match.value(event).pipe(
    Match.tag("SessionPromptEvent", ({ prompt }) => Result.succeed(prompt)),
    Match.tag("SessionStreamEvent", ({ part }) => Result.succeed(part)),
    Match.orElse(() => Result.failVoid),
  );

/**
 * Streams one trajectory per session of a trail.
 *
 * **Details**
 *
 * Session events are grouped by the index of the session they belong to, and
 * every group is folded into a trajectory. Trajectories end with the session
 * end event of their session, and their groups are unbounded, so that sessions
 * can be consumed in sequence while the trail is still streaming.
 */
export const sessions = <E>(
  events: Stream.Stream<Event.TrailSuccessEvent, E>,
): Stream.Stream<Trajectory.Any, ResultError | E> =>
  events.pipe(
    Stream.filter(Schema.is(Event.SessionSuccessEvent)),
    Stream.groupByKey((event) => event.id.sessionIdx),
    Stream.map(([, session]) =>
      Trajectory.fromSession(
        session.pipe(Stream.takeUntil(isSessionEndEvent), Stream.filterMap(sessionPart)),
        Toolkit.empty,
      ),
    ),
  );

export class TaskResult<S extends Schema.Constraint> extends Data.TaggedClass("TaskResult")<{
  id: string;
  result: S["Type"];
}> {}

type TrailReduceExec<G extends Schema.Constraint, S extends Schema.Constraint> = (
  trailResults: ReadonlyArray<TrailResult<G>>,
) => Effect.Effect<TaskResult<NoInfer<S>>, ResultError>;

export type TrailReducer<G extends Schema.Constraint, S extends Schema.Constraint> = Readonly<{
  schema: S;
  exec: TrailReduceExec<G, S>;
}>;

export const reduceTrails = <S extends Schema.Constraint>(schema: S) => {};

export const reduceTasks = <S extends Schema.Constraint>(schema: S) => {};
