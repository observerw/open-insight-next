import { Data, Effect, Scope, Stream } from "effect";
import * as Sandbox from "#/Sandbox.ts";
import * as Trajectory from "#/Trajectory.ts";
import * as Metric from "#/Metric.ts";
import type { IndexByKey } from "./Types.ts";

export class Metrickit<Metrics extends Record<string, Metric.Any>> extends Data.Class<{
  metrics: Metrics;
}> {}
export type MetricsOf<T> = T extends Metrickit<infer Metrics> ? Metrics : never;
export type Any = Metrickit<Record<string, Metric.Any>>;

export const make = <Metrics extends ReadonlyArray<Metric.Any>>(
  ...metrics: Metrics
): Metrickit<IndexByKey<Metrics, "id">> => {
  return new Metrickit({
    metrics: Object.fromEntries(metrics.map((metric) => [metric.id, metric])),
  });
};

export const empty = make();

export type ResultStream<Metrics extends Record<string, Metric.Any>> = Stream.Stream<
  Metric.ResultOf<Metrics[keyof Metrics]>,
  Metric.MetricError
>;

export const run = Effect.fn("Metric.run")(function* <Metrics extends Record<string, Metric.Any>>(
  metrickit: Metrickit<Metrics>,
  {
    trajectories,
    sandbox,
  }: {
    trajectories: Stream.Stream<Trajectory.Any, Metric.MetricError>;
    sandbox: Sandbox.Sandbox;
  },
): Effect.fn.Return<ResultStream<Metrics>, never, Scope.Scope> {
  const broadcasted = yield* trajectories.pipe(Stream.broadcast({ capacity: "unbounded" }));
  const transformed = Object.values(metrickit.metrics).map((metric) =>
    metric.transform(broadcasted, sandbox),
  );
  return Stream.mergeAll(transformed, { concurrency: "unbounded" });
});
