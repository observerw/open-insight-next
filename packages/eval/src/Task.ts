import { Prompt, Sandbox, Snapshot, Trajectory } from "@open-insight/core";
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

export class SessionResult extends Data.TaggedClass("SessionResult")<{
  trajectory: Trajectory.Any;
}> {}

export class TrailResult<G extends Schema.Constraint> extends Data.TaggedClass("TrailResult")<{
  grade: G["Type"];
  sessions: Array<SessionResult>;
}> {}

export class TaskResult<S extends Schema.Constraint> extends Data.TaggedClass("TaskResult")<{
  id: string;
  result: S["Type"];
}> {}

export type Reducer<G extends Schema.Constraint, S extends Schema.Constraint> = Readonly<{
  exec: (trailResults: ReadonlyArray<TrailResult<G>>) => Effect.Effect<TaskResult<S>, TaskError>;
  schema: S;
}>;

export interface Config {
  readonly grade: Schema.Constraint;
  readonly result: Schema.Constraint;
}

export class Task<ID extends string, C extends Config> extends Data.TaggedClass("Task")<{
  id: ID;
  metadata: Metadata;

  prompt: Prompt.Session;
  snapshot: Snapshot.Template;
  resources: Sandbox.Resources;
  grader: Grade.Template<C["grade"]>;
  reducer: Reducer<C["grade"], C["result"]>;
}> {}

export type Any = Task<any, any>;

export type IdOf<T> = T extends Task<infer ID, any> ? ID : never;
export type ConfigOf<T> = T extends Task<any, infer C> ? C : never;

type Options<C extends Config> = Omit<MetadataEncoded, "id"> &
  Readonly<{
    prompt: Prompt.Session;
    grader: Grade.Template<C["grade"]>;
    reducer: Reducer<C["grade"], C["result"]>;

    description?: string | null;
    snapshot?: Snapshot.Template;
    resources?: Sandbox.Resources;
  }>;

export const make = <ID extends string, C extends Config>(
  id: ID,
  options: Options<C>,
): Task<ID, C> => {
  const {
    prompt,
    grader,
    reducer,
    snapshot = Snapshot.Alpine,
    resources = Sandbox.providerDefault,
  } = options;

  const metadata = Schema.decodeSync(Metadata)({ id, ...options });

  return new Task({
    id,
    metadata,
    prompt,
    grader,
    reducer,
    snapshot,
    resources,
  });
};
