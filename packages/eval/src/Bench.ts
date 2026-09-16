import * as Task from "#/Task.ts";
import type { Types } from "@open-insight/core";
import { Data, Effect, Schema } from "effect";

export const ErrorReason = Schema.Union([]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class BenchError extends Schema.TaggedError<BenchError>("open-insight/eval/BenchError")(
  "BenchError",
  {
    reason: ErrorReason,
  },
) {}

export class Metadata extends Schema.Class<Metadata>("BenchMetadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export type BenchResult<S extends Schema.Constraint> = Readonly<{ id: string; result: S["Type"] }>;

type TaskResultsOf<Tasks extends Record<string, Task.Any>> = Readonly<{
  [K in keyof Tasks]: Task.ConfigOf<Tasks[K]>["result"]["Type"];
}>;

export type Reducer<
  Tasks extends Record<string, Task.Any>,
  S extends Schema.Constraint,
> = Readonly<{
  exec: (tasks: TaskResultsOf<Tasks>) => Effect.Effect<BenchResult<NoInfer<S>>, BenchError>;
  schema: S;
}>;

export interface Config<S extends Schema.Constraint = Schema.Constraint> {
  readonly result: S;
}

export class Bench<
  ID extends string,
  Tasks extends Record<string, Task.Any>,
  C extends Config,
> extends Data.Class<{
  id: ID;
  metadata: Metadata;

  tasks: Tasks;
  reducer: Reducer<Tasks, C["result"]>;
}> {}

export type Any = Bench<any, any, any>;
export type IDOf<B> = B extends Bench<infer ID, any, any> ? ID : never;
export type TasksOf<B> = B extends Bench<any, infer Tasks, any> ? Tasks : never;
export type ConfigOf<B> = B extends Bench<any, any, infer C> ? C : never;

type Options<Tasks extends Record<string, Task.Any>, S extends Schema.Constraint> = Omit<
  MetadataEncoded,
  "id"
> &
  Readonly<{
    reducer: Reducer<Tasks, S>;
  }>;

export const fromArray = <
  ID extends string,
  Tasks extends ReadonlyArray<Task.Any>,
  S extends Schema.Constraint,
>(
  id: ID,
  tasks: Tasks,
  options: Options<Types.IndexByKey<Tasks, "id">, S>,
): Bench<ID, Types.IndexByKey<Tasks, "id">, Config<S>> => {
  const metadata = Schema.decodeSync(Metadata)({ id, ...options });

  return new Bench<ID, Types.IndexByKey<Tasks, "id">, Config<S>>({
    id,
    metadata,
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
    reducer: options.reducer,
  });
};

export const make = <
  ID extends string,
  Tasks extends ReadonlyArray<Task.Any>,
  S extends Schema.Constraint,
>(
  id: ID,
  options: Options<Types.IndexByKey<Tasks, "id">, S>,
  ...tasks: Tasks
): Bench<ID, Types.IndexByKey<Tasks, "id">, Config<S>> =>
  fromArray<ID, Tasks, S>(id, tasks, options);

export const mapTasks = <
  ID extends string,
  Tasks extends Record<string, Task.Any>,
  C extends Config,
>(
  bench: Bench<ID, Tasks, C>,
  mapper: (tasks: Tasks, bench: Bench<ID, Tasks, C>) => Tasks,
): Bench<ID, Tasks, C> =>
  new Bench<ID, Tasks, C>({
    id: bench.id,
    metadata: bench.metadata,
    tasks: mapper(bench.tasks, bench),
    reducer: bench.reducer,
  });

export const mapTasksEffect = <
  ID extends string,
  Tasks extends Record<string, Task.Any>,
  C extends Config,
  E,
  R,
>(
  bench: Bench<ID, Tasks, C>,
  mapper: (tasks: Tasks, bench: Bench<ID, Tasks, C>) => Effect.Effect<Tasks, E, R>,
): Effect.Effect<Bench<ID, Tasks, C>, E, R> =>
  mapper(bench.tasks, bench).pipe(Effect.map((tasks) => mapTasks(bench, () => tasks)));

export const mapTask = <
  ID extends string,
  Tasks extends Record<string, Task.Any>,
  C extends Config,
  Key extends keyof Tasks,
>(
  bench: Bench<ID, Tasks, C>,
  id: Key,
  mapper: (task: Tasks[Key], bench: Bench<ID, Tasks, C>) => Tasks[Key],
): Bench<ID, Tasks, C> =>
  new Bench<ID, Tasks, C>({
    id: bench.id,
    metadata: bench.metadata,
    tasks: { ...bench.tasks, [id]: mapper(bench.tasks[id], bench) },
    reducer: bench.reducer,
  });

export const mapTaskEffect = <
  ID extends string,
  Tasks extends Record<string, Task.Any>,
  C extends Config,
  Key extends keyof Tasks,
  E,
  R,
>(
  bench: Bench<ID, Tasks, C>,
  id: Key,
  mapper: (task: Tasks[Key], bench: Bench<ID, Tasks, C>) => Effect.Effect<Tasks[Key], E, R>,
): Effect.Effect<Bench<ID, Tasks, C>, E, R> =>
  mapper(bench.tasks[id], bench).pipe(Effect.map((task) => mapTask(bench, id, () => task)));
