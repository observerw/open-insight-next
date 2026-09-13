import * as Response from "#/response/index.ts";
import { Effect, Match, Schema, Stream } from "effect";
import { type Tool, Toolkit } from "effect/unstable/ai";
import { Part, type Trajectory } from "./Trajectory.ts";
import { responses } from "./View.ts";
import type { TrajectoryError } from "./TrajectoryError.ts";

export type ToolTurns<Tools extends Record<string, Tool.Any>> = {
  [Name in keyof Tools]: Name extends string
    ? Readonly<{
        call: Extract<Response.ToolCallPartsView<Tools>, { name: Name }>;
        result: Extract<Response.ToolResultPartsView<Tools>, { name: Name }>;
      }>
    : never;
}[keyof Tools];

export const toolTurns = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<ToolTurns<Tools>, TrajectoryError> => {
  const toolNames = new Set(Object.keys(trajectory.toolkit.tools));

  return responses(trajectory).pipe(
    Stream.mapAccum<
      ReadonlyMap<string, Response.ToolCallParts<Tools>>,
      Response.AllPartsView<Tools>,
      ToolTurns<Tools>
    >(
      () => new Map(),
      (pending, response) => {
        if (response.type === "tool-call" && toolNames.has(response.name)) {
          const call = response as Response.ToolCallParts<Tools>;
          const next = new Map(pending);
          next.set(call.id, call);

          return [next, []];
        }

        if (
          response.type !== "tool-result" ||
          response.preliminary === true ||
          !toolNames.has(response.name)
        ) {
          return [pending, []];
        }

        const call = pending.get(response.id);

        if (call === undefined || call.name !== response.name) {
          return [pending, []];
        }

        const next = new Map(pending);
        next.delete(response.id);

        return [next, [{ call, result: response } as ToolTurns<Tools>]];
      },
    ),
  );
};

export const toolCalls = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<Response.ToolCallPartsView<Tools>, TrajectoryError> =>
  toolTurns(trajectory).pipe(Stream.map((turn) => turn.call));

export const toolkits = <Toolkits extends ReadonlyArray<Toolkit.Any>>(...toolkits: Toolkits) =>
  Effect.fn(function* <Tools extends Record<string, Tool.Any>>(trajectory: Trajectory<Tools>) {
    const merged = Toolkit.merge(trajectory.toolkit, ...toolkits);

    const sourceSchema = Response.PartView(trajectory.toolkit);
    const partSchema = Response.PartView(merged);
    const trajectoryPart = Part(merged);
    const encode = Schema.encodeEffect(sourceSchema);
    const decode = Schema.decodeEffect(partSchema);

    const context = yield* Effect.context<
      typeof sourceSchema.EncodingServices | typeof partSchema.DecodingServices
    >();

    const parts = trajectory.pipe(
      Stream.mapEffect((part) =>
        Match.value(part).pipe(
          Match.tag("Prompt", (prompt) => Effect.succeed(trajectoryPart.make(prompt))),
          Match.tag(
            "Response",
            Effect.fn(function* (response) {
              const encoded = yield* encode(response.response);
              const decoded = yield* decode(encoded);

              return trajectoryPart.make({
                uuid: response.uuid,
                _tag: "Response",
                response: decoded,
              });
            }),
          ),
          Match.exhaustive,
        ),
      ),
      Stream.provideContext(context),
    );

    return Object.assign(parts, { toolkit: merged });
  });
