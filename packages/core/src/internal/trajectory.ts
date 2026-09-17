import { Predicate, Stream } from "effect";
import type * as Tool from "#/Tool.ts";
import * as Prompt from "#/Prompt.ts";
import * as Response from "#/Response.ts";
import type * as Trajectory from "#/Trajectory.ts";

type AccumulatedContent = {
  text: string;
  metadata: Response.ProviderMetadata;
};

type FoldState = {
  readonly text: Map<string, AccumulatedContent>;
  readonly reasoning: Map<string, AccumulatedContent>;
};

const mergeMetadata = (
  left: Response.ProviderMetadata,
  right: Response.ProviderMetadata,
): Response.ProviderMetadata => {
  const result = { ...left };

  for (const [provider, metadata] of Object.entries(right)) {
    const previous = result[provider];
    result[provider] =
      Predicate.isObject(previous) && Predicate.isObject(metadata)
        ? Object.assign({}, previous, metadata)
        : metadata;
  }

  return result;
};

/**
 * Folds a stream of prompts and streamed response parts into a stream of prompts
 * and response parts.
 *
 * **Details**
 *
 * Every prompt is emitted as-is and clears the parts accumulated for the
 * previous turn, while streamed text and reasoning parts are folded into a
 * single response part once their stream ends.
 */
export const foldSession = <Tools extends Record<string, Tool.Any>, E>(
  session: Stream.Stream<Trajectory.AllSessionPart<Tools>, E>,
): Stream.Stream<Prompt.Prompt | Response.PartView<Tools>, E> =>
  session.pipe(
    Stream.mapAccum<
      FoldState,
      Trajectory.AllSessionPart<Tools>,
      Prompt.Prompt | Response.PartView<Tools>
    >(
      () => ({ text: new Map(), reasoning: new Map() }),
      (state, event) => {
        if (Prompt.isPrompt(event)) {
          state.text.clear();
          state.reasoning.clear();

          return [state, [event]];
        }

        switch (event.type) {
          case "text-start":
            state.text.set(event.id, { text: "", metadata: event.metadata });

            return [state, []];
          case "text-delta": {
            const active = state.text.get(event.id);

            if (active !== undefined) {
              active.text += event.delta;
              active.metadata = mergeMetadata(active.metadata, event.metadata);
            }

            return [state, []];
          }

          case "text-end": {
            const active = state.text.get(event.id);

            if (active === undefined) {
              return [state, []];
            }

            state.text.delete(event.id);

            return [
              state,
              [
                Response.makePart("text", {
                  text: active.text,
                  metadata: mergeMetadata(active.metadata, event.metadata),
                }),
              ],
            ];
          }

          case "reasoning-start":
            state.reasoning.set(event.id, { text: "", metadata: event.metadata });

            return [state, []];
          case "reasoning-delta": {
            const active = state.reasoning.get(event.id);

            if (active !== undefined) {
              active.text += event.delta;
              active.metadata = mergeMetadata(active.metadata, event.metadata);
            }

            return [state, []];
          }

          case "reasoning-end": {
            const active = state.reasoning.get(event.id);

            if (active === undefined) {
              return [state, []];
            }

            state.reasoning.delete(event.id);

            return [
              state,
              [
                Response.makePart("reasoning", {
                  text: active.text,
                  metadata: mergeMetadata(active.metadata, event.metadata),
                }),
              ],
            ];
          }

          case "tool-params-start":
          case "tool-params-delta":
          case "tool-params-end":
          case "error":
            return [state, []];
          default:
            return [state, [event]];
        }
      },
    ),
  );
