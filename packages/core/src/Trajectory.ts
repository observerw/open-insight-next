/**
 * Defines a shared model for recorded interactions with a model.
 *
 * A trajectory is a stream of parts: prompt parts record the messages sent to a
 * model, response parts record the parts produced in return, and the trajectory
 * carries the toolkit used to interpret tool parts and metadata describing it.
 */
import { Effect, Function, Match, Option, Predicate, Result, Schema, Sink, Stream } from "effect";
import { type Tool, Toolkit } from "effect/unstable/ai";
import * as Prompt from "#/Prompt.ts";
import * as Response from "#/Response.ts";
import * as StreamStore from "#/StreamStore.ts";
import { Timestamp, Uuid } from "#/Schema.ts";
import * as ToolkitData from "#/Toolkit.ts";

/**
 * Error indicating that a trajectory part could not be encoded.
 */
export class EncodeError extends Schema.TaggedError<EncodeError>(
  "open-insight/trajectory/EncodeError",
)("EncodeError", {
  message: Schema.optional(Schema.String),
}) {}

/**
 * Error indicating that an encoded trajectory part could not be decoded.
 */
export class DecodeError extends Schema.TaggedError<DecodeError>(
  "open-insight/trajectory/DecodeError",
)("DecodeError", {
  message: Schema.optional(Schema.String),
}) {}

/**
 * Error indicating that a trajectory could not be saved.
 */
export class SaveError extends Schema.TaggedError<SaveError>("open-insight/trajectory/SaveError")(
  "SaveError",
  { path: Schema.String },
) {
  override get message(): string {
    return `Failed to save trajectory at ${this.path}`;
  }
}

/**
 * Error indicating that a trajectory could not be loaded.
 */
export class LoadError extends Schema.TaggedError<LoadError>("open-insight/trajectory/LoadError")(
  "LoadError",
  { path: Schema.String },
) {
  override get message(): string {
    return `Failed to load trajectory at ${this.path}`;
  }
}

/**
 * Error indicating that a trajectory stream failed.
 */
export class StreamingError extends Schema.TaggedError<StreamingError>(
  "open-insight/trajectory/StreamingError",
)("StreamingError", {
  /**
   * The defect that caused the failure.
   */
  cause: Schema.Defect(),
  message: Schema.optional(Schema.String),
}) {}

/**
 * Schema for the reasons a trajectory operation can fail.
 */
export const TrajectoryErrorReason = Schema.Union([
  EncodeError,
  DecodeError,
  SaveError,
  LoadError,
  StreamingError,
]);

/**
 * Union of the reasons a trajectory operation can fail.
 */
export type TrajectoryErrorReason = Schema.Schema.Type<typeof TrajectoryErrorReason>;

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : undefined);

/**
 * Error raised by trajectory operations.
 */
export class TrajectoryError extends Schema.TaggedError<TrajectoryError>(
  "open-insight/trajectory/TrajectoryError",
)("TrajectoryError", {
  /**
   * The reason this trajectory operation failed.
   */
  reason: TrajectoryErrorReason,
}) {
  override get message(): string {
    return this.reason.message ?? this.reason._tag;
  }

  /**
   * Creates a trajectory error for an encode failure.
   */
  static encode = (cause: unknown) =>
    new TrajectoryError({ reason: new EncodeError({ message: errorMessage(cause) }) });

  /**
   * Creates a trajectory error for a decode failure.
   */
  static decode = (cause: unknown) =>
    new TrajectoryError({ reason: new DecodeError({ message: errorMessage(cause) }) });

  /**
   * Creates a trajectory error for a save failure.
   */
  static save = (path: string) => new TrajectoryError({ reason: new SaveError({ path }) });

  /**
   * Creates a trajectory error for a load failure.
   */
  static load = (path: string) => new TrajectoryError({ reason: new LoadError({ path }) });

  /**
   * Creates a trajectory error for a stream failure.
   */
  static streaming = (cause: unknown) =>
    new TrajectoryError({
      reason: new StreamingError({ cause, message: errorMessage(cause) }),
    });
}

/**
 * Descriptive metadata attached to a trajectory.
 */
export class Metadata extends Schema.Class<Metadata>("Metadata")({
  /**
   * Optional identifier of the trajectory.
   */
  id: Schema.optional(Schema.String),
  /**
   * Optional name of the trajectory.
   */
  name: Schema.optional(Schema.String),
  /**
   * Optional description of the trajectory.
   */
  description: Schema.optional(Schema.String),
}) {}

/**
 * Encoded representation of metadata for serialization.
 */
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

/**
 * Schema for the metadata carried by every trajectory part.
 */
export const PartMetadata = Schema.Struct({
  /**
   * Unique identifier of the part.
   */
  uuid: Uuid,
  /**
   * Optional identifier of the session the part belongs to.
   */
  session: Schema.optional(Schema.String),
  /**
   * Optional extra data attached to the part.
   */
  extra: Schema.optional(Schema.Json),
});

/**
 * Metadata carried by every trajectory part.
 */
export type PartMetadata = Schema.Schema.Type<typeof PartMetadata>;

/**
 * Schema for validation and encoding of prompt parts.
 */
export const PromptPart = Schema.TaggedStruct("Prompt", {
  messages: Schema.Array(Prompt.Message),
  ...PartMetadata.fields,
});

/**
 * Trajectory part that records the messages sent to a model.
 */
export type PromptPart = Schema.Schema.Type<typeof PromptPart>;

/**
 * Encoded representation of prompt parts for serialization.
 */
export type PromptPartEncoded = Schema.Codec.Encoded<typeof PromptPart>;

/**
 * Constructs a new prompt part from a prompt.
 *
 * **Example** (Recording a prompt)
 *
 * ```ts import.meta.vitest
 * import { Prompt, Trajectory } from "@open-insight/core"
 *
 * const part = Trajectory.promptPart(Prompt.make("What is 2 + 2?"))
 * part._tag // => "Prompt"
 * ```
 */
export const promptPart = (prompt: Prompt.Prompt): PromptPart =>
  PromptPart.make({ messages: prompt.content });

/**
 * Creates a Schema for a response part based on a toolkit.
 *
 * **Details**
 *
 * The timestamp is recorded when the part is constructed, and the response
 * accepts tools outside the provided toolkit.
 */
export const ResponsePart = <T extends Toolkit.Any>(toolkit: T) =>
  Schema.TaggedStruct("Response", {
    response: Response.PartView(toolkit),
    timestamp: Timestamp,
    ...PartMetadata.fields,
  });

/**
 * Trajectory part that records a part produced by a model.
 */
export type ResponsePart<T extends Toolkit.Any> = Schema.Schema.Type<
  ReturnType<typeof ResponsePart<T>>
>;

/**
 * Encoded representation of response parts for serialization.
 */
export type ResponsePartEncoded = Schema.Codec.Encoded<ReturnType<typeof ResponsePart<any>>>;

/**
 * Schema for a response part that also accepts tools outside the provided
 * toolkit.
 *
 * @see {@link ResponsePart} for a Schema restricted to the provided toolkit.
 */
export const AnyResponsePart = ResponsePart(Toolkit.empty);

/**
 * Response part that also accepts tools outside the provided toolkit.
 */
export type AnyResponsePart = Schema.Schema.Type<typeof AnyResponsePart>;

/**
 * Constructs a new response part from a part produced by a model.
 *
 * **Example** (Recording a response part)
 *
 * ```ts import.meta.vitest
 * import { Response, Trajectory } from "@open-insight/core"
 *
 * const part = Trajectory.responsePart(Response.makePart("text", { text: "Hello" }))
 * part._tag // => "Response"
 * ```
 */
export const responsePart = (response: Response.Part<any>): AnyResponsePart =>
  AnyResponsePart.make({ response });

/**
 * Creates a Schema for trajectory parts based on a toolkit.
 */
export const Part = <Tools extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Tools>) =>
  Schema.Union([PromptPart, ResponsePart(toolkit)]);

/**
 * Union type of the parts of a trajectory for a toolkit.
 */
export type Part<Tools extends Record<string, Tool.Any>> = Schema.Schema.Type<
  ReturnType<typeof Part<Tools>>
>;

/**
 * Encoded representation of trajectory parts for serialization.
 */
export type PartEncoded = Schema.Codec.Encoded<ReturnType<typeof Part<any>>>;

/**
 * Trajectory part that also accepts tools outside the provided toolkit.
 */
export type AnyPart = PromptPart | AnyResponsePart;

/**
 * Stream of the parts of a trajectory.
 */
export type PartStream<Tools extends Record<string, Tool.Any>> = Stream.Stream<
  Part<Tools>,
  TrajectoryError
>;

/**
 * Stream of trajectory parts that also accepts tools outside the provided
 * toolkit.
 */
export type AnyPartStream = PartStream<Record<string, never>>;

/**
 * Stream of trajectory parts with the toolkit and metadata of a trajectory.
 */
export type Trajectory<Tools extends Record<string, Tool.Any>> = PartStream<Tools> &
  Readonly<{
    /**
     * The toolkit used to encode and decode tool parts.
     */
    toolkit: Toolkit.Toolkit<Tools>;
    /**
     * The metadata of the trajectory.
     */
    metadata: Metadata;
  }>;

/**
 * Trajectory that also accepts tools outside the provided toolkit.
 */
export type Any = Trajectory<Record<string, never>>;

/**
 * Encoded stream of trajectory parts for serialization.
 */
export type TrajectoryEncoded = Stream.Stream<PartEncoded, TrajectoryError>;

/**
 * Creates a trajectory from a stream of parts and a toolkit.
 *
 * **Details**
 *
 * The metadata is decoded from its encoded form, and failures of the source
 * stream are mapped to {@link StreamingError}.
 *
 * **Example** (Creating a trajectory)
 *
 * ```ts import.meta.vitest
 * import { Prompt, Trajectory } from "@open-insight/core"
 * import { Stream } from "effect"
 * import { Toolkit } from "effect/unstable/ai"
 *
 * const trajectory = Trajectory.make(
 *   Stream.make(Trajectory.promptPart(Prompt.make("Hello"))),
 *   Toolkit.empty,
 *   { name: "greeting" }
 * )
 * trajectory.metadata.name // => "greeting"
 * ```
 */
export const make = <Tools extends Record<string, Tool.Any>, E>(
  parts: Stream.Stream<Part<Tools>, E>,
  toolkit: Toolkit.Toolkit<Tools>,
  metadata: MetadataEncoded = {},
): Trajectory<Tools> =>
  Object.assign(parts.pipe(Stream.mapError(TrajectoryError.streaming)), {
    toolkit,
    metadata: Schema.decodeSync(Metadata)(metadata),
  });

/**
 * Encodes a trajectory into its serializable representation.
 *
 * **Details**
 *
 * Parts are encoded using the schema of the trajectory's toolkit, and encoding
 * failures are mapped to {@link EncodeError}.
 */
export const encode = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Effect.fn.Return<
  TrajectoryEncoded,
  TrajectoryError,
  Tool.ResultEncodingServices<Tools[keyof Tools]>
> {
  const partSchema = Part(trajectory.toolkit);
  const encodingContext = yield* Effect.context<typeof partSchema.EncodingServices>();
  const encodePart = Schema.encodeEffect(partSchema);

  return trajectory.pipe(
    Stream.mapEffect((part) =>
      encodePart(part).pipe(
        Effect.mapError(TrajectoryError.encode),
        Effect.provideContext(encodingContext),
      ),
    ),
  );
}, Stream.unwrap);

/**
 * Decodes a serialized trajectory using the provided toolkits.
 *
 * **Details**
 *
 * The toolkits are merged and used to decode the parts of the trajectory, and
 * decoding failures are mapped to {@link DecodeError}. The returned trajectory
 * carries the merged toolkit.
 */
export const decode = Effect.fn(function* <Toolkits extends ReadonlyArray<Toolkit.Any>>(
  trajectory: TrajectoryEncoded,
  ...toolkits: Toolkits
) {
  const toolkit = Toolkit.merge(...toolkits);
  const partSchema = Part(toolkit);
  const decodingContext = yield* Effect.context<typeof partSchema.DecodingServices>();
  const decodePart = Schema.decodeEffect(partSchema);

  const parts = trajectory.pipe(
    Stream.mapEffect((part) =>
      decodePart(part).pipe(
        Effect.mapError(TrajectoryError.decode),
        Effect.provideContext(decodingContext),
      ),
    ),
  );

  return Object.assign(parts, { toolkit }) as Trajectory<Toolkit.MergedTools<Toolkits>>;
});

/**
 * Adds toolkits to a trajectory, decoding tool parts that were previously
 * unknown.
 *
 * **Details**
 *
 * Tool parts outside the trajectory's toolkit are re-encoded and decoded against
 * the merged toolkit, and decoding failures are mapped to {@link DecodeError}.
 */
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
              const encoded = yield* encode(response.response).pipe(
                Effect.mapError(TrajectoryError.decode),
              );
              const decoded = yield* decode(encoded).pipe(Effect.mapError(TrajectoryError.decode));
              return trajectoryPart.make({ ...response, response: decoded });
            }),
          ),
          Match.exhaustive,
        ),
      ),
      Stream.provideContext(context),
    );

    return Object.assign(parts, { toolkit: merged, metadata: trajectory.metadata });
  });

/**
 * A tool call paired with the final result of that call.
 */
export type ToolTurn<Tools extends Record<string, Tool.Any>> = {
  [Name in keyof Tools]: Name extends string
    ? Readonly<{
        /**
         * The tool call part.
         */
        call: Extract<Response.ToolCallParts<Tools>, { name: Name }>;
        /**
         * The final tool result part.
         */
        result: Extract<Response.ToolResultParts<Tools>, { name: Name }>;
      }>
    : never;
}[keyof Tools];

/**
 * Pairs a tool call with its result, or returns `undefined` when they do not
 * name the same tool.
 */
export const toolTurn = <Tools extends Record<string, Tool.Any>>(
  call: Response.ToolCallParts<Tools>,
  result: Response.ToolResultParts<Tools>,
): ToolTurn<Tools> | undefined => {
  if (call.name !== result.name) {
    return undefined;
  }

  // SAFETY: Equal tool names correlate both union members to the same toolkit entry.
  return { call, result } as ToolTurn<Tools>;
};

/**
 * Emits a turn for every tool call of a trajectory that has a final result.
 *
 * **Details**
 *
 * Preliminary results, results without a matching call, and results whose tool
 * name differs from the call are ignored.
 */
export const toolTurns = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<ToolTurn<Tools>, TrajectoryError> =>
  toResponses(trajectory).pipe(
    Stream.mapAccum<
      Map<string, Response.ToolCallParts<Tools>>,
      Response.AllPartsView<Tools>,
      ToolTurn<Tools>
    >(
      () => new Map(),
      (calls, response) => {
        if (response.type === "tool-call") {
          if (Response.isToolPart<Tools>(response)) {
            calls.set(response.id, response);
          } else {
            calls.delete(response.id);
          }

          return [calls, []];
        }

        if (
          response.type !== "tool-result" ||
          response.preliminary ||
          !Response.isToolPart<Tools>(response)
        ) {
          return [calls, []];
        }

        const call = calls.get(response.id);

        if (call === undefined) {
          return [calls, []];
        }

        const turn = toolTurn(call, response);

        if (turn === undefined) {
          return [calls, []];
        }

        calls.delete(response.id);

        return [calls, [turn]];
      },
    ),
  );

/**
 * Sets the metadata of a trajectory.
 *
 * **Details**
 *
 * Supports both data-first and data-last usage.
 */
export const metadata = Function.dual<
  <T extends Any>(metadata: Metadata) => (trajectory: T) => T,
  <T extends Any>(trajectory: T, metadata: Metadata) => T
>(2, <T extends Any>(trajectory: T, metadata: Metadata): T =>
  Object.assign(trajectory, { metadata }),
);

/**
 * A prompt paired with the response parts produced for it.
 */
export type SessionTurn<Tools extends Record<string, Tool.Any>> = Readonly<{
  /**
   * The prompt of the turn.
   */
  prompt: Prompt.Prompt;
  /**
   * The response parts produced for the prompt.
   */
  response: Response.PartView<Tools>[];
}>;

/**
 * Stream of session turns.
 */
export type Session<Tools extends Record<string, Tool.Any>> = Stream.Stream<
  SessionTurn<Tools>,
  TrajectoryError
>;

const SessionEnd = Symbol("open-insight/trajectory/SessionEnd");

/**
 * Groups the parts of a trajectory into session turns.
 *
 * **Details**
 *
 * A turn starts at a prompt part and collects the response parts that follow
 * it. Response parts before the first prompt are ignored.
 */
export const toSession = <Tools extends Record<string, Tool.Any>>(
  trajectory: PartStream<Tools>,
): Session<Tools> =>
  trajectory.pipe(
    Stream.concat(Stream.succeed(SessionEnd)),
    Stream.mapAccum<
      SessionTurn<Tools> | undefined,
      Part<Tools> | typeof SessionEnd,
      SessionTurn<Tools>
    >(
      () => undefined,
      (turn, part) => {
        if (part === SessionEnd) {
          return [undefined, turn === undefined ? [] : [turn]];
        }

        if (part._tag === "Prompt") {
          const next = {
            prompt: Prompt.fromMessages(part.messages),
            response: [],
          } satisfies SessionTurn<Tools>;

          return [next, turn === undefined ? [] : [turn]];
        }

        if (turn === undefined) {
          return [turn, []];
        }

        turn.response.push(part.response);

        return [turn, []];
      },
    ),
  );

/**
 * Stream of streamed session turns.
 */
export type SessionStream<Tools extends Record<string, Tool.Any>, E> = Stream.Stream<
  Prompt.Prompt | Response.AllPartsView<Tools>,
  E
>;

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
 * Flattens a stream of prompts and streamed response parts into a trajectory.
 *
 * **Details**
 *
 * Every prompt contributes a prompt part and clears the parts accumulated for
 * the previous turn, while streamed text and reasoning parts are folded into a
 * single part once their stream ends.
 */
export const fromStreamSession = <Tools extends Record<string, Tool.Any>, E>(
  session: SessionStream<Tools, E>,
  toolkit: Toolkit.Toolkit<Tools>,
  metadata: MetadataEncoded = {},
): Trajectory<Tools> => {
  const responsePartSchema = ResponsePart(toolkit);

  const parts = session
    .pipe(
      Stream.mapAccum<FoldState, Prompt.Prompt | Response.AllPartsView<Tools>, Part<Tools>>(
        () => ({ text: new Map(), reasoning: new Map() }),
        (state, event) => {
          if (Prompt.isPrompt(event)) {
            state.text.clear();
            state.reasoning.clear();

            return [state, [promptPart(event)]];
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
                  responsePartSchema.make({
                    response: Response.makePart("text", {
                      text: active.text,
                      metadata: mergeMetadata(active.metadata, event.metadata),
                    }),
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
                  responsePartSchema.make({
                    response: Response.makePart("reasoning", {
                      text: active.text,
                      metadata: mergeMetadata(active.metadata, event.metadata),
                    }),
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
              return [state, [responsePartSchema.make({ response: event })]];
          }
        },
      ),
    )
    .pipe(Stream.mapError(TrajectoryError.streaming));

  return Object.assign(parts, { toolkit, metadata: Schema.decodeSync(Metadata)(metadata) });
};

/**
 * Folds a trajectory into the prompt that represents the conversation.
 */
export const toPrompt = <Tools extends Record<string, Tool.Any>>(
  trajectory: PartStream<Tools>,
): Effect.Effect<Prompt.Prompt, TrajectoryError> =>
  toSession(trajectory).pipe(
    Stream.runFold(
      () => Prompt.empty,
      (curr, { prompt, response }) =>
        Prompt.concat(curr, Prompt.concat(prompt, Prompt.fromResponseParts(response))),
    ),
  );

/**
 * Extracts the response parts of a trajectory, discarding prompt parts.
 */
export const toResponses = <Tools extends Record<string, Tool.Any>>(
  trajectory: PartStream<Tools>,
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
 * Sink that reduces a trajectory to its last finish part.
 */
export const finishPart: Sink.Sink<Option.Option<Response.FinishPart>, Part<any>> = Sink.reduce(
  () => Option.none<Response.FinishPart>(),
  (state, part) =>
    part._tag === "Response" && part.response.type === "finish"
      ? Option.some(part.response)
      : state,
);

/**
 * Sink that reduces a trajectory to its last response metadata part.
 */
export const metadataPart: Sink.Sink<
  Option.Option<Response.ResponseMetadataPart>,
  AnyPart
> = Sink.reduce(
  () => Option.none<Response.ResponseMetadataPart>(),
  (state, part) =>
    part._tag === "Response" && part.response.type === "response-metadata"
      ? Option.some(part.response)
      : state,
);

/**
 * Reports the usage of the last finish part of a trajectory.
 */
export const usage = (
  trajectory: AnyPartStream,
): Effect.Effect<Option.Option<Response.Usage>, TrajectoryError> =>
  trajectory.pipe(
    Stream.run(finishPart),
    Effect.map((part) => Option.map(part, (p) => p.usage)),
  );

/**
 * Reports the finish reason of the last finish part of a trajectory.
 */
export const finishReason = (
  trajectory: AnyPartStream,
): Effect.Effect<Option.Option<Response.FinishReason>, TrajectoryError> =>
  trajectory.pipe(
    Stream.run(finishPart),
    Effect.map((part) => Option.map(part, (p) => p.reason)),
  );

/**
 * Emits every response metadata part of a trajectory.
 */
export const responseMetadataParts = (
  trajectory: AnyPartStream,
): Stream.Stream<Response.ResponseMetadataPart, TrajectoryError> =>
  trajectory.pipe(toResponses).pipe(Stream.filter((part) => part.type === "response-metadata"));

/**
 * Persists a trajectory to a path and returns the trajectory loaded back from
 * that path.
 *
 * **Details**
 *
 * The file starts with the encoded metadata and the encoded toolkit, followed
 * by one encoded part per line. Saving failures are mapped to {@link SaveError},
 * and loading failures are mapped to {@link LoadError}.
 */
export const persist = (path: string) =>
  Effect.fn(function* <Tools extends Record<string, Tool.Any>>(trajectory: Trajectory<Tools>) {
    const store = yield* StreamStore.StreamStore;
    const partSchema = Part(trajectory.toolkit);
    const decodingContext = yield* Effect.context<typeof partSchema.DecodingServices>();

    const encodedMetadata = yield* Schema.encodeEffect(Metadata)(trajectory.metadata).pipe(
      Effect.mapError(TrajectoryError.encode),
    );

    const encodedParts = encode(trajectory);

    const lines = Stream.make(encodedMetadata, ToolkitData.encode(trajectory.toolkit)).pipe(
      Stream.concat(encodedParts),
    );

    yield* store
      .save(Schema.Unknown)(path, lines)
      .pipe(Effect.mapError(() => TrajectoryError.save(path)));

    const headers = yield* store
      .load(Schema.Unknown)(path, { limit: 2 })
      .pipe(
        Stream.runCollect,
        Effect.mapError(() => TrajectoryError.load(path)),
      );

    const encodedLoadedMetadata = headers[0];
    const encodedToolkit = headers[1];

    if (encodedLoadedMetadata === undefined || encodedToolkit === undefined) {
      return yield* TrajectoryError.load(path);
    }

    const loadedMetadata = yield* Schema.decodeUnknownEffect(Metadata)(encodedLoadedMetadata).pipe(
      Effect.mapError(() => TrajectoryError.load(path)),
    );

    // The encoded toolkit describes the file, but cannot reconstruct runtime tool codecs.
    yield* Schema.decodeUnknownEffect(Schema.JsonObject)(encodedToolkit).pipe(
      Effect.mapError(() => TrajectoryError.load(path)),
    );

    const decodePart = Schema.decodeUnknownEffect(partSchema);

    const parts = store
      .load(Schema.Unknown)(path, { offset: 2 })
      .pipe(
        Stream.mapEffect((part) => decodePart(part).pipe(Effect.provideContext(decodingContext))),
        Stream.mapError(() => TrajectoryError.load(path)),
      );

    return Object.assign(parts, {
      toolkit: trajectory.toolkit,
      metadata: loadedMetadata,
    });
  });
