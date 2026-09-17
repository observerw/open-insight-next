import { Data, Schema } from "effect";
import * as Bench from "./Bench.ts";
import { Harness } from "@open-insight/core";
import type { NodeSdk } from "@effect/opentelemetry";

export class Metadata extends Schema.Class<Metadata>("EvalMetadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

/** Runtime configuration for an evaluation run. */
export type Config = Readonly<{
  /** Configuration for the OpenTelemetry Node SDK. Defaults to an empty configuration. */
  otel: NodeSdk.Configuration;

  /** Maximum number of snapshot builds executed concurrently. Defaults to `1`. */
  snapshotConcurrency: number;

  /** Maximum number of evaluation trails executed concurrently. Defaults to `32`. */
  trailConcurrency: number;

  /** Number of successful independent evaluation trails run for each task. Defaults to `1`. */
  trailCount: number;

  /** Number of times to retry a trail if it fails. Defaults to `3`. */
  trailRetry: number | "unlimited";

  /** Whether to run verification instead of run agent. Defaults to `false`. */
  verify: boolean;
}>;

/** Default runtime configuration used when no evaluation overrides are provided. */
export const DefaultConfig: Required<Config> = {
  otel: {},
  snapshotConcurrency: 32,
  trailConcurrency: 32,
  trailCount: 1,
  trailRetry: 3,
  verify: false,
};

export const RunOptions = Schema.Struct({
  trailCount: Schema.Number,
});
export type RunOptions = Schema.Schema.Type<typeof RunOptions>;

/** Creates an evaluation configuration by applying overrides to {@link DefaultConfig}. */
export const makeConfig = (options: Partial<Config> = {}): Config => ({
  ...DefaultConfig,
  ...options,
});

export class Eval<
  ID extends string,
  B extends Bench.Any,
  H extends Harness.Any,
> extends Data.Class<{
  id: ID;

  bench: B;
  harness: H;
  metadata: Metadata;

  options: RunOptions;
}> {}
export type Any = Eval<string, Bench.Any, Harness.Any>;

export type IDOf<E> = E extends Eval<infer ID, any, any> ? ID : never;
export type BenchOf<E> = E extends Eval<any, infer B, any> ? B : never;
export type HarnessOf<E> = E extends Eval<any, any, infer H> ? H : never;

type Options<B extends Bench.Any, H extends Harness.Any> = Omit<MetadataEncoded, "id"> &
  RunOptions &
  Readonly<{
    bench: B;
    harness: H;
  }>;

export const make = <ID extends string, B extends Bench.Any, H extends Harness.Any>(
  id: ID,
  options: Options<B, H>,
) => {
  const metadata = Schema.decodeSync(Metadata)({ id, ...options });
  const runOptions = Schema.decodeSync(RunOptions)(options);
  const { bench, harness } = options;

  return new Eval({ id, bench, harness, metadata, options: runOptions });
};
