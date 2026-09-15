import { Predicate, Stream } from "effect";
import { type Tool } from "effect/unstable/ai";
import * as Response from "#/Response.ts";

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

export const fold = <Tools extends Record<string, Tool.Any>, E, R>(
  stream: Stream.Stream<Response.AllPartsView<Tools>, E, R>,
): Stream.Stream<Response.PartView<Tools>, E, R> =>
  stream.pipe(
    Stream.mapAccum<FoldState, Response.AllPartsView<Tools>, Response.PartView<Tools>>(
      () => ({ text: new Map(), reasoning: new Map() }),
      (state, part) => {
        switch (part.type) {
          case "text-start":
            state.text.set(part.id, { text: "", metadata: part.metadata });

            return [state, []];
          case "text-delta": {
            const active = state.text.get(part.id);

            if (active !== undefined) {
              active.text += part.delta;
              active.metadata = mergeMetadata(active.metadata, part.metadata);
            }

            return [state, []];
          }

          case "text-end": {
            const active = state.text.get(part.id);

            if (active === undefined) {
              return [state, []];
            }

            state.text.delete(part.id);

            return [
              state,
              [
                Response.makePart("text", {
                  text: active.text,
                  metadata: mergeMetadata(active.metadata, part.metadata),
                }),
              ],
            ];
          }

          case "reasoning-start":
            state.reasoning.set(part.id, { text: "", metadata: part.metadata });

            return [state, []];
          case "reasoning-delta": {
            const active = state.reasoning.get(part.id);

            if (active !== undefined) {
              active.text += part.delta;
              active.metadata = mergeMetadata(active.metadata, part.metadata);
            }

            return [state, []];
          }

          case "reasoning-end": {
            const active = state.reasoning.get(part.id);

            if (active === undefined) {
              return [state, []];
            }

            state.reasoning.delete(part.id);

            return [
              state,
              [
                Response.makePart("reasoning", {
                  text: active.text,
                  metadata: mergeMetadata(active.metadata, part.metadata),
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
            return [state, [part]];
        }
      },
    ),
  );
