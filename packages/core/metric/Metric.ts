import type { IndexByKey } from "#/utils/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import * as Trajectory from "#/trajectory/index.ts";
import type { MetricError } from "./error.ts";
import { Data, DateTime, Effect, Schema, Scope, Stream } from "effect";

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export const Result = <S extends Schema.Constraint>(schema: S) =>
  Schema.Struct({
    result: schema,

    /**
     * Metric ID.
     */
    id: Schema.String,

    /**
     * Timestamp when the metric value is emitted.
     */
    timestamp: Schema.DateTimeUtcFromString,

    /**
     * Associated trajectory part ID, if any.
     *
     * Available when the metric value is emitted according to a specific trajectory part.
     */
    partID: Schema.optional(Schema.String),
  });

export type Result<ID extends string, S extends Schema.Constraint> = Readonly<{
  id: ID;
  result: S["Type"];
  timestamp: DateTime.Utc;
  partID?: string;
}>;

export class Metric<ID extends string, S extends Schema.Constraint>
  extends Data.Class<{
    id: ID;
    schema: S;
    metadata: Metadata;

    transform: (
      sessions: Stream.Stream<Trajectory.Any, MetricError>,
    ) => Stream.Stream<Result<ID, S>, MetricError, Sandbox.Sandbox>;
  }> {}
export type Any = Metric<any, any>;
export type ResultOf<M extends Any> = Result<M["id"], M["schema"]>;
export type ResultsOf<Ms extends Record<string, Any>> = Readonly<
  {
    [K in keyof Ms]: ResultOf<Ms[K]>[];
  }
>;

export class Registry<Metrics extends Record<string, Any>> extends Data.Class<{
  metrics: Metrics;
}> {}
export type MetricsOf<T> = T extends Registry<infer Metrics> ? Metrics : never;

export const make = <Metrics extends ReadonlyArray<Any>>(
  ...metrics: Metrics
): Registry<IndexByKey<Metrics, "id">> => {
  return new Registry({
    metrics: Object.fromEntries(metrics.map((metric) => [metric.id, metric])),
  });
};

export type ResultStream<Metrics extends Record<string, Any>> = Stream.Stream<
  ResultOf<Metrics[keyof Metrics]>,
  MetricError,
  Sandbox.Sandbox
>;

export const run = Effect.fn("Metric.run")(
  function* <Metrics extends Record<string, Any>>(
    registry: Registry<Metrics>,
    sessions: Stream.Stream<Trajectory.Any, MetricError>,
  ): Effect.fn.Return<ResultStream<Metrics>, never, Scope.Scope> {
    const broadcast = yield* sessions.pipe(
      Stream.broadcast({ capacity: "unbounded" }),
    );
    const streams = Object.values(registry.metrics).map((metric) =>
      metric.transform(broadcast)
    );

    return Stream.mergeAll(streams, { concurrency: "unbounded" });
  },
);
