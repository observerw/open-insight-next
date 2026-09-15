import * as Task from "#/task/index.ts";
import { IndexByKey } from "@open-insight/core/Types";
import { Data, Schema } from "effect";

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
): Bench<ID, IndexByKey<Tasks, "id">> => {
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
): Bench<ID, IndexByKey<Tasks, "id">> => fromArray(id, tasks, options);
