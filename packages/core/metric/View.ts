import type { Stream } from "effect";
import * as Traj from "#/trajectory/index.ts";
import * as Metric from "./metric.ts";
import type { Tool } from "effect/unstable/ai";
import type { MetricError } from "./error.ts";

export type Part<
  Tools extends Record<string, Tool.Any>,
  Metrics extends Record<string, Metric.Any>,
> =
  & Traj.Part<Tools>
  & Readonly<{
    metrics: {
      [K in keyof Metrics]: Array<Metric.ResultOf<Metrics[K]>["result"]>;
    };
  }>;

export type Trajectory<
  Tools extends Record<string, Tool.Any>,
  Metrics extends Record<string, Metric.Any>,
> = Stream.Stream<Part<Tools, Metrics>, MetricError>;

export const make = <
  Tools extends Record<string, Tool.Any>,
  Metrics extends Record<string, Metric.Any>,
>(
  trajectory: Traj.Trajectory<Tools>,
  metrics: Metric.ResultStream<Metrics>,
): Trajectory<Tools, Metrics> => {
  throw new Error("not implemented");
};
