import { Metric, Metrickit, Prompt, Sandbox, Snapshot, Trajectory } from "@open-insight/core";
import * as Grade from "#/Grade.ts";
import { Data, Effect, Schema } from "effect";

export class TaskError extends Data.TaggedError("TaskError")<{
  readonly cause: unknown;
}> {
  static readonly result = (cause: unknown) => new TaskError({ cause });
}

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export class TrailResult<G extends Schema.Constraint> extends Data.TaggedClass("TrailResult")<{
  grade: G["Type"];
  sessions: Array<Trajectory.Any>;
}> {}

export class TaskResult<S extends Schema.Constraint> extends Data.TaggedClass("TaskResult")<{
  id: string;
  result: S["Type"];
}> {}

export type Reducer<G extends Schema.Constraint, S extends Schema.Constraint> = Readonly<{
  exec: (
    trailResults: ReadonlyArray<TrailResult<G>>,
  ) => Effect.Effect<TaskResult<NoInfer<S>>, TaskError>;
  schema: S;
}>;

export interface Config<
  Grade extends Schema.Constraint = Schema.Constraint,
  Result extends Schema.Constraint = Schema.Constraint,
  Metrics extends Record<string, Metric.Any> = Record<string, Metric.Any>,
> {
  readonly grade: Grade;
  readonly result: Result;
  readonly metrics: Metrics;
}

export class Task<ID extends string, C extends Config> extends Data.TaggedClass("Task")<{
  id: ID;
  metadata: Metadata;

  prompt: Prompt.Session;
  snapshot: Snapshot.Template;
  resources: Sandbox.Resources;
  grader: Grade.Template<C["grade"]>;
  reducer: Reducer<C["grade"], C["result"]>;
  metrickit: Metrickit.Metrickit<C["metrics"]>;
}> {}

export type Any = Task<any, any>;

export type IdOf<T> = T extends Task<infer ID, any> ? ID : never;
export type ConfigOf<T> = T extends Task<any, infer C> ? C : never;

type Options<
  Grade extends Schema.Constraint,
  Result extends Schema.Constraint,
  Metrics extends Record<string, Metric.Any>,
> = Omit<MetadataEncoded, "id"> &
  Readonly<{
    prompt: Prompt.Session;
    grader: Grade.Template<Grade>;
    reducer: Reducer<Grade, Result>;

    description?: string | null;
    snapshot?: Snapshot.Template;
    resources?: Sandbox.Resources;
    metrickit?: Metrickit.Metrickit<Metrics>;
  }>;

export const make = <
  ID extends string,
  Grade extends Schema.Constraint,
  Result extends Schema.Constraint,
  Metrics extends Record<string, Metric.Any>,
>(
  id: ID,
  options: Options<Grade, Result, Metrics>,
): Task<ID, Config<Grade, Result>> => {
  const {
    prompt,
    grader,
    reducer,
    snapshot = Snapshot.Alpine,
    resources = Sandbox.providerDefault,
    metrickit = Metrickit.empty,
  } = options;

  const metadata = Schema.decodeSync(Metadata)({ id, ...options });

  return new Task<ID, Config<Grade, Result>>({
    id,
    metadata,
    prompt,
    grader,
    reducer,
    snapshot,
    resources,
    metrickit,
  });
};
