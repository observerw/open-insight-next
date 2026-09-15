import { Schema } from "effect";
import { Prompt, Metric, Response, Harness } from "@open-insight/core";
import * as Bench from "#/Bench.ts";
import * as Task from "#/Task.ts";
import { Toolkit } from "effect/unstable/ai";

export const EvalID = Schema.String;

export const TaskID = Schema.Struct({
  evalID: EvalID,
  taskID: Schema.String,
});

export type TaskID = Schema.Schema.Type<typeof TaskID>;

export const TrailID = Schema.Struct({
  ...TaskID.fields,
  trailIdx: Schema.Number,
});

export type TrailID = Schema.Schema.Type<typeof TrailID>;

export const SessionID = Schema.Struct({
  ...TrailID.fields,
  sessionIdx: Schema.Number,
});

export type SessionID = Schema.Schema.Type<typeof SessionID>;

export class SessionStartEvent extends Schema.TaggedClass<SessionStartEvent>()(
  "SessionStartEvent",
  {
    id: SessionID,
  },
) {}

export class SessionPromptEvent extends Schema.TaggedClass<SessionPromptEvent>()(
  "SessionPromptEvent",
  {
    id: SessionID,
    prompt: Prompt.Prompt,
  },
) {}

export class SessionStreamEvent extends Schema.TaggedClass<SessionStreamEvent>()(
  "SessionStreamEvent",
  {
    id: SessionID,
    part: Response.Part(Toolkit.empty),
  },
) {}

export class SessionRetryEvent extends Schema.TaggedClass<SessionRetryEvent>()(
  "SessionRetryEvent",
  {
    id: SessionID,
    reason: Schema.NullOr(Schema.String),
  },
) {}

export class SessionEndEvent extends Schema.TaggedClass<SessionEndEvent>()("SessionEndEvent", {
  id: SessionID,
  usage: Schema.NullOr(Response.Usage),
  reason: Schema.NullOr(Response.FinishReason),
}) {}

export const SessionSuccessEvent = Schema.Union([
  SessionStartEvent,
  SessionPromptEvent,
  SessionStreamEvent,
  SessionRetryEvent,
  SessionEndEvent,
]);

export type SessionSuccessEvent = Schema.Schema.Type<typeof SessionSuccessEvent>;

export class SessionErrorEvent extends Schema.TaggedClass<SessionErrorEvent>()(
  "SessionErrorEvent",
  {
    id: SessionID,
    error: Schema.Defect(),
  },
) {}

export const SessionFailedEvent = Schema.Union([SessionErrorEvent]);

export type SessionFailedEvent = Schema.Schema.Type<typeof SessionFailedEvent>;

export class TrailStartEvent extends Schema.TaggedClass<TrailStartEvent>()("TrailStartEvent", {
  id: TrailID,
}) {}

export class TrailEndEvent extends Schema.TaggedClass<TrailEndEvent>()("TrailEndEvent", {
  id: TrailID,
  grade: Schema.Unknown,
}) {}

export class MetricEvent extends Schema.TaggedClass<MetricEvent>()("MetricEvent", {
  id: TrailID,
  metricID: Schema.String,
  result: Metric.Result(Schema.Unknown),
}) {}

export class MetricErrorEvent extends Schema.TaggedClass<MetricErrorEvent>()("MetricErrorEvent", {
  id: TrailID,
  metricID: Schema.String,
  error: Schema.Defect(),
}) {}

export const TrailSuccessEvent = Schema.Union([
  TrailStartEvent,
  SessionSuccessEvent,
  TrailEndEvent,
  MetricEvent,
  MetricErrorEvent,
]);

export type TrailSuccessEvent = Schema.Schema.Type<typeof TrailSuccessEvent>;

export class TrailErrorEvent extends Schema.TaggedClass<TrailErrorEvent>()("TrailErrorEvent", {
  id: TrailID,
  error: Schema.Defect(),
}) {}

export const TrailFailedEvent = Schema.Union([TrailErrorEvent, SessionFailedEvent]);

export type TrailFailedEvent = Schema.Schema.Type<typeof TrailFailedEvent>;

export class TaskStartEvent extends Schema.TaggedClass<TaskStartEvent>()("TaskStartEvent", {
  id: TaskID,
  task: Task.Metadata,
  extra: Schema.Option(Schema.Unknown),
}) {}

export class TaskEndEvent extends Schema.TaggedClass<TaskEndEvent>()("TaskEndEvent", {
  id: TaskID,
}) {}

export const TaskSuccessEvent = Schema.Union([TaskStartEvent, TrailSuccessEvent, TaskEndEvent]);

export type TaskSuccessEvent = Schema.Schema.Type<typeof TaskSuccessEvent>;

export class TaskErrorEvent extends Schema.TaggedClass<TaskErrorEvent>()("TaskErrorEvent", {
  id: TaskID,
  error: Schema.Defect(),
}) {}

export const TaskFailedEvent = Schema.Union([TaskErrorEvent, TrailFailedEvent]);

export type TaskFailedEvent = Schema.Schema.Type<typeof TaskFailedEvent>;

export class EvalStartEvent extends Schema.TaggedClass<EvalStartEvent>()("EvalStartEvent", {
  id: EvalID,
  bench: Bench.Metadata,
  harness: Harness.Metadata,
}) {}

export class EvalEndEvent extends Schema.TaggedClass<EvalEndEvent>()("EvalEndEvent", {
  id: EvalID,
}) {}

export const EvalSuccessEvent = Schema.Union([EvalStartEvent, TaskSuccessEvent, EvalEndEvent]);

export type EvalSuccessEvent = Schema.Schema.Type<typeof EvalSuccessEvent>;

export class EvalErrorEvent extends Schema.TaggedClass<EvalErrorEvent>()("EvalErrorEvent", {
  id: EvalID,
  error: Schema.Defect(),
}) {}

export const EvalFailedEvent = Schema.Union([EvalErrorEvent, TaskFailedEvent]);

export type EvalFailedEvent = Schema.Schema.Type<typeof EvalFailedEvent>;

export const EvalEvent = Schema.Union([EvalSuccessEvent, EvalFailedEvent]);

export type EvalEvent = Schema.Schema.Type<typeof EvalEvent>;
