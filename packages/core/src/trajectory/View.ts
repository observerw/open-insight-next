import * as Prompt from "#/prompt/index.ts";
import type * as Response from "#/response/index.ts";
import type * as Trajectory from "./Trajectory.ts";
import type { Tool } from "effect/unstable/ai";
import { Effect, Match, Option, Result, Sink, Stream } from "effect";
import type { TrajectoryError } from "./TrajectoryError.ts";

export type SessionTurn<Tools extends Record<string, Tool.Any>> = Readonly<{
  prompt: Prompt.Prompt;
  response: Response.PartView<Tools>[];
}>;

export type Session<Tools extends Record<string, Tool.Any>> = Stream.Stream<
  SessionTurn<Tools>,
  TrajectoryError
>;

export const session = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory.PartStream<Tools>,
): Session<Tools> => {
  throw new Error("not implemented");
};

export const prompt = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory.PartStream<Tools>,
): Effect.Effect<Prompt.Prompt, TrajectoryError> =>
  session(trajectory).pipe(
    Stream.runFold(
      () => Prompt.empty,
      (curr, { prompt, response }) =>
        Prompt.concat(curr, Prompt.concat(prompt, Prompt.fromResponseParts(response))),
    ),
  );

export const responses = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory.PartStream<Tools>,
): Stream.Stream<Response.AllPartsView<Tools>, TrajectoryError> =>
  trajectory.pipe(
    Stream.filterMap((part) =>
      Match.value(part).pipe(
        Match.tag("Response", ({ response }) => Result.succeed(response)),
        Match.tag("Prompt", (prompt) => Result.fail(prompt)),
        Match.exhaustive,
      ),
    ),
  );

/**
 * Sink that extracts the last finish part from a response stream.
 */
export const finishPart: Sink.Sink<
  Option.Option<Response.FinishPart>,
  Trajectory.Part<any>
> = Sink.reduce(
  () => Option.none<Response.FinishPart>(),
  (state, part) =>
    part._tag === "Response" && part.response.type === "finish"
      ? Option.some(part.response)
      : state,
);

export const metadataPart: Sink.Sink<
  Option.Option<Response.ResponseMetadataPart>,
  Trajectory.AnyPart
> = Sink.reduce(
  () => Option.none<Response.ResponseMetadataPart>(),
  (state, part) =>
    part._tag === "Response" && part.response.type === "response-metadata"
      ? Option.some(part.response)
      : state,
);

export const usage = (
  trajectory: Trajectory.AnyPartStream,
): Effect.Effect<Option.Option<Response.Usage>, TrajectoryError> =>
  trajectory.pipe(
    Stream.run(finishPart),
    Effect.map((part) => Option.map(part, (p) => p.usage)),
  );

export const finishReason = (
  trajectory: Trajectory.AnyPartStream,
): Effect.Effect<Option.Option<Response.FinishReason>, TrajectoryError> =>
  trajectory.pipe(
    Stream.run(finishPart),
    Effect.map((part) => Option.map(part, (p) => p.reason)),
  );

export const responseMetadataParts = (
  trajectory: Trajectory.AnyPartStream,
): Stream.Stream<Response.ResponseMetadataPart, TrajectoryError> =>
  trajectory.pipe(responses).pipe(Stream.filter((part) => part.type === "response-metadata"));
