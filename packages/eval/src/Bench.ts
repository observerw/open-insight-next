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

type ReduceExec<Tasks extends Record<string, Task.Any>, S extends Schema.Constraint> = (
  tasks: TaskResultsOf<Tasks>,
) => Effect.Effect<BenchResult<NoInfer<S>>, BenchError>;

export type Reducer<
  Tasks extends Record<string, Task.Any>,
  S extends Schema.Constraint,
> = Readonly<{
  schema: S;
  exec: ReduceExec<Tasks, S>;
}>;

export type AnyConfig = Readonly<{
  tasks: Record<string, Task.Any>;
  result: Schema.Constraint;
}>;

export class Bench<ID extends string, Config extends AnyConfig> extends Data.Class<{
  id: ID;
  metadata: Metadata;

  tasks: Config["tasks"];
  reducer: Reducer<Config["tasks"], Config["result"]>;
}> {}

export type Any = Bench<any, any>;

type Options = Omit<MetadataEncoded, "id">;

export const fromArray = <ID extends string, Tasks extends ReadonlyArray<Task.Any>>(
  id: ID,
  tasks: Tasks,
  options: Options,
) => {
  const metadata = Schema.decodeSync(Metadata)({ id, ...options });

  const resultSchema = Schema.Struct(
    Object.fromEntries(
      tasks.map((task): [string, Schema.Constraint] => [task.id, task.reducer.schema]),
    ),
  );

  const reducer = {
    schema: resultSchema,
    exec: (results) => Effect.succeed({ id, result: results }),
  } satisfies Reducer<Types.IndexByKey<Tasks, "id">, typeof resultSchema>;

  return new Bench<ID, { tasks: Types.IndexByKey<Tasks, "id">; result: typeof resultSchema }>({
    id,
    metadata,
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
    reducer,
  });
};

export const make = <ID extends string, Tasks extends ReadonlyArray<Task.Any>>(
  id: ID,
  options: Options,
  ...tasks: Tasks
) => fromArray<ID, Tasks>(id, tasks, options);

export const reducer =
  <S extends Schema.Constraint>(schema: S, exec: ReduceExec<Record<string, Task.Any>, S>) =>
  <ID extends string, C extends AnyConfig>(bench: Bench<ID, C>) =>
    new Bench<ID, Types.Override<C, { result: S }>>({
      id: bench.id,
      metadata: bench.metadata,
      tasks: bench.tasks,
      reducer: { schema, exec },
    });

export const mapTasks = <ID extends string, Config extends AnyConfig>(
  bench: Bench<ID, Config>,
  mapper: (tasks: Config["tasks"], bench: Bench<ID, Config>) => Config["tasks"],
): Bench<ID, Config> =>
  new Bench<ID, Config>({
    id: bench.id,
    metadata: bench.metadata,
    tasks: mapper(bench.tasks, bench),
    reducer: bench.reducer,
  });

export const mapTasksEffect = <ID extends string, Config extends AnyConfig, E, R>(
  bench: Bench<ID, Config>,
  mapper: (
    tasks: Config["tasks"],
    bench: Bench<ID, Config>,
  ) => Effect.Effect<Config["tasks"], E, R>,
): Effect.Effect<Bench<ID, Config>, E, R> =>
  mapper(bench.tasks, bench).pipe(Effect.map((tasks) => mapTasks(bench, () => tasks)));

export const mapTask = <
  ID extends string,
  Config extends AnyConfig,
  Key extends keyof Config["tasks"],
>(
  bench: Bench<ID, Config>,
  id: Key,
  mapper: (task: Config["tasks"][Key], bench: Bench<ID, Config>) => Config["tasks"][Key],
): Bench<ID, Config> =>
  new Bench<ID, Config>({
    id: bench.id,
    metadata: bench.metadata,
    tasks: { ...bench.tasks, [id]: mapper(bench.tasks[id], bench) },
    reducer: bench.reducer,
  });

export const mapTaskEffect = <
  ID extends string,
  Config extends AnyConfig,
  Key extends keyof Config["tasks"],
  E,
  R,
>(
  bench: Bench<ID, Config>,
  id: Key,
  mapper: (
    task: Config["tasks"][Key],
    bench: Bench<ID, Config>,
  ) => Effect.Effect<Config["tasks"][Key], E, R>,
): Effect.Effect<Bench<ID, Config>, E, R> =>
  mapper(bench.tasks[id], bench).pipe(Effect.map((task) => mapTask(bench, id, () => task)));
