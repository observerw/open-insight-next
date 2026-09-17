import { Metric, Prompt, Sandbox, Snapshot } from "@open-insight/core";
import * as Grade from "#/Grade.ts";
import { Data, Schema } from "effect";

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

export class Task<ID extends string, Grade extends Schema.Constraint> extends Data.TaggedClass(
  "Task",
)<{
  id: ID;
  metadata: Metadata;

  prompt: Prompt.Session;
  snapshot: Snapshot.Template;
  resources: Sandbox.Resources;
  grader: Grade.Template<Grade>;
}> {}

export type Any = Task<any, any>;

export type IdOf<T> = T extends Task<infer ID, any> ? ID : never;
export type ConfigOf<T> = T extends Task<any, infer C> ? C : never;

type Options<Grade extends Schema.Constraint> = Omit<MetadataEncoded, "id"> &
  Readonly<{
    prompt: Prompt.Session;
    grader: Grade.Template<Grade>;

    description?: string | null;
    snapshot?: Snapshot.Template;
    resources?: Sandbox.Resources;
  }>;

export const make = <ID extends string, Grade extends Schema.Constraint>(
  id: ID,
  options: Options<Grade>,
) => {
  const {
    prompt,
    grader,
    snapshot = Snapshot.Alpine,
    resources = Sandbox.providerDefault,
  } = options;

  const metadata = Schema.decodeSync(Metadata)({ id, ...options });

  return new Task<ID, Grade>({
    id,
    metadata,
    prompt,
    grader,
    snapshot,
    resources,
  });
};
