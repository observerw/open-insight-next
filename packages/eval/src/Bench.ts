import * as Task from "#/Task.ts";
import type { Types } from "@open-insight/core";
import { Data, Effect, Schema } from "effect";
import { Readonly } from "effect/unstable/ai/Tool";

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

export class Bench<ID extends string, Tasks extends Record<string, Task.Any>> extends Data.Class<{
  id: ID;
  metadata: Metadata;
  tasks: Tasks;
}> {}
export type Any = Bench<string, Record<string, Task.Any>>;
export type IDOf<B extends Any> = B["id"];
export type TasksOf<B extends Any> = B["tasks"];

type Options = Omit<MetadataEncoded, "id"> & Readonly<{}>;
export const fromArray = <ID extends string, Tasks extends ReadonlyArray<Task.Any>>(
  id: ID,
  tasks: Tasks,
  options: Options = {},
): Bench<ID, Types.IndexByKey<Tasks, "id">> => {
  const metadata = Schema.decodeSync(Metadata)({ id, ...options });
  return new Bench({
    id,
    metadata,
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
  });
};

export const make = <ID extends string, Tasks extends ReadonlyArray<Task.Any>>(
  id: ID,
  options: Options,
  ...tasks: Tasks
): Bench<ID, Types.IndexByKey<Tasks, "id">> => fromArray(id, tasks, options);

export type MappedTasks<
  Tasks extends Record<string, Task.Any>,
  ID extends keyof Tasks,
  Mapped extends Task.Any,
> = {
  readonly [Key in keyof Tasks]: Key extends ID ? Mapped : Tasks[Key];
};

export const mapTasks =
  <B extends Any, Mapped extends Record<string, Task.Any>>(
    mapper: (tasks: TasksOf<B>, bench: B) => Mapped,
  ) =>
  (bench: B): Types.Override<B, Bench<IDOf<B>, Mapped>> => {
    return Object.assign(new Bench(bench), {
      tasks: mapper(bench.tasks, bench),
    }) as Types.Override<B, Bench<IDOf<B>, Mapped>>;
  };

export const mapTasksEffect = <B extends Any, Mapped extends Record<string, Task.Any>, E, R>(
  mapper: (tasks: TasksOf<B>, bench: B) => Effect.Effect<Mapped, E, R>,
) =>
  Effect.fn(function* (
    bench: B,
  ): Effect.fn.Return<Types.Override<B, Bench<IDOf<B>, Mapped>>, E, R> {
    const tasks: TasksOf<B> = bench.tasks;
    const mapped = yield* mapper(tasks, bench);
    return mapTasks<B, Mapped>(() => mapped)(bench);
  });

export const mapTask =
  <B extends Any, ID extends keyof TasksOf<B>, Mapped extends Task.Any>(
    id: ID,
    mapper: (task: TasksOf<B>[ID], bench: B) => Mapped,
  ) =>
  (bench: B): Types.Override<B, Bench<IDOf<B>, MappedTasks<TasksOf<B>, ID, Mapped>>> => {
    const tasks: TasksOf<B> = bench.tasks;
    return Object.assign(new Bench(bench), {
      tasks: { ...tasks, [id]: mapper(tasks[id], bench) },
    }) as Types.Override<B, Bench<IDOf<B>, MappedTasks<TasksOf<B>, ID, Mapped>>>;
  };

export const mapTaskEffect = <
  B extends Any,
  ID extends keyof TasksOf<B>,
  Mapped extends Task.Any,
  E,
  R,
>(
  id: ID,
  mapper: (task: TasksOf<B>[ID], bench: B) => Effect.Effect<Mapped, E, R>,
) =>
  Effect.fn(function* (
    bench: B,
  ): Effect.fn.Return<
    Types.Override<B, Bench<IDOf<B>, MappedTasks<TasksOf<B>, ID, Mapped>>>,
    E,
    R
  > {
    const tasks: TasksOf<B> = bench.tasks;
    const mapped = yield* mapper(tasks[id], bench);
    return mapTask<B, ID, Mapped>(id, () => mapped)(bench);
  });

export type BenchResult<S extends Schema.Constraint> = Readonly<{ id: string; result: S["Type"] }>;

type TaskResultsOf<Tasks extends Record<string, Task.Any>> = Readonly<{
  [K in keyof Tasks]: Task.ConfigOf<Tasks[K]>["result"]["Type"];
}>;
export type Reducer<Tasks extends Record<string, Task.Any>, S extends Schema.Constraint> = (
  tasks: TaskResultsOf<Tasks>,
) => Effect.Effect<BenchResult<S>, BenchError> & Readonly<{ schema: S }>;
