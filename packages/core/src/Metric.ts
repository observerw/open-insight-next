import { Data, DateTime, Effect, Formatter, Schedule, Schema, Scope, Stream } from "effect";
import * as Trajectory from "#/Trajectory.ts";
import * as Sandbox from "#/Sandbox.ts";
import type { IndexByKey } from "./Types.ts";
import { fromSchedule } from "./internal/metric.ts";

/** A response part does not match the schema declared by its tool. */
export class ToolSchemaMismatch extends Schema.TaggedError<ToolSchemaMismatch>(
  "open-insight/core/MetricError/ToolSchemaMismatch",
)("ToolSchemaMismatch", {
  name: Schema.String,
  cause: Schema.Defect(),
  data: Schema.Unknown,
}) {
  override get message(): string {
    return `Tool schema mismatch for ${this.name}: ${Formatter.format(this.cause)}`;
  }
}

export class TransformFailed extends Schema.TaggedError<TransformFailed>(
  "open-insight/core/MetricError/TransformFailed",
)("TransformFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Error transforming into metric stream: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([ToolSchemaMismatch, TransformFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** Errors raised while evaluating a metric. */
export class MetricError extends Schema.TaggedError<MetricError>("open-insight/core/MetricError")(
  "MetricError",
  {
    reason: ErrorReason,
  },
) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static toolMismatch = (name: string, data: unknown) => (cause: Schema.SchemaError) =>
    MetricError.make({
      reason: ToolSchemaMismatch.make({ cause, name, data }),
    });

  static transform = (cause: unknown) =>
    MetricError.make({
      reason: TransformFailed.make({ cause }),
    });
}

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

export class Metric<ID extends string, S extends Schema.Constraint> extends Data.Class<{
  id: ID;
  schema: S;
  metadata: Metadata;

  transform: (
    sessions: Stream.Stream<Trajectory.Any, MetricError>,
  ) => Stream.Stream<Result<ID, S>, MetricError, Sandbox.Sandbox>;
}> {}
export type Any = Metric<any, any>;
export type ResultOf<M extends Any> = Result<M["id"], M["schema"]>;
export type ResultsOf<Ms extends Record<string, Any>> = Readonly<{
  [K in keyof Ms]: ResultOf<Ms[K]>[];
}>;

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

export const run = Effect.fn("Metric.run")(function* <Metrics extends Record<string, Any>>(
  registry: Registry<Metrics>,
  sessions: Stream.Stream<Trajectory.Any, MetricError>,
): Effect.fn.Return<ResultStream<Metrics>, never, Scope.Scope> {
  const broadcast = yield* sessions.pipe(Stream.broadcast({ capacity: "unbounded" }));
  const streams = Object.values(registry.metrics).map((metric) => metric.transform(broadcast));

  return Stream.mergeAll(streams, { concurrency: "unbounded" });
});

type TrajectoryOptions = MetadataEncoded & Readonly<{}>;
type Observation<S extends Schema.Constraint> = Readonly<{
  result: S["Type"];
  part: Trajectory.ResponsePart<any>;
}>;
export const trajectoryMetric = <ID extends string, S extends Schema.Constraint>(
  id: ID,
  schema: S,
  transform: (trajectory: Trajectory.AnyPartStream) => Stream.Stream<Observation<S>, MetricError>,
  options: TrajectoryOptions = {},
) => {
  const metadata = Schema.decodeSync(Metadata)(options);

  return new Metric({
    id,
    schema,
    metadata,
    transform: (sessions) =>
      sessions.pipe(
        Stream.flatMap((trajectory) =>
          transform(trajectory).pipe(
            Stream.map(
              ({ result, part: { timestamp, uuid } }) =>
                ({
                  id,
                  result,
                  timestamp,
                  partID: uuid,
                }) satisfies Result<ID, S>,
            ),
          ),
        ),
        Stream.mapError(MetricError.transform),
      ),
  });
};

type SchedOptions = MetadataEncoded &
  Readonly<{
    schedule?: Schedule.Schedule<unknown>;
  }>;
export const schedMetric = <ID extends string, S extends Schema.Constraint, E>(
  id: ID,
  schema: S,
  transform: (sched: Stream.Stream<DateTime.DateTime, E>) => Stream.Stream<S["Type"], MetricError>,
  options: SchedOptions = {},
) => {
  const metadata = Schema.decodeSync(Metadata)(options);
  const schedule = fromSchedule(options.schedule);

  return new Metric({
    id,
    schema,
    metadata,
    transform: () =>
      transform(schedule).pipe(
        Stream.mapEffect((result) =>
          DateTime.now.pipe(
            Effect.map((timestamp) => ({ id, result, timestamp }) satisfies Result<ID, S>),
          ),
        ),
        Stream.mapError(MetricError.transform),
      ),
  });
};
