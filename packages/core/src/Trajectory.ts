import { Effect, Function, Match, Option, Result, Schema, Sink, Stream } from "effect";
import { type Tool, Toolkit } from "effect/unstable/ai";
import * as Prompt from "#/Prompt.ts";
import * as Response from "#/Response.ts";
import * as NdjsonStore from "#/NdjsonStore.ts";
import { Timestamp, Uuid } from "#/Schema.ts";
import * as ToolkitData from "#/Toolkit.ts";
import { fold } from "#/internal/fold.ts";

export class EncodeError extends Schema.TaggedError<EncodeError>(
  "open-insight/trajectory/EncodeError",
)("EncodeError", {
  message: Schema.optional(Schema.String),
}) {}

export class DecodeError extends Schema.TaggedError<DecodeError>(
  "open-insight/trajectory/DecodeError",
)("DecodeError", {
  message: Schema.optional(Schema.String),
}) {}

export class SaveError extends Schema.TaggedError<SaveError>("open-insight/trajectory/SaveError")(
  "SaveError",
  { path: Schema.String },
) {
  override get message(): string {
    return `Failed to save trajectory at ${this.path}`;
  }
}

export class LoadError extends Schema.TaggedError<LoadError>("open-insight/trajectory/LoadError")(
  "LoadError",
  { path: Schema.String },
) {
  override get message(): string {
    return `Failed to load trajectory at ${this.path}`;
  }
}

export class StreamingError extends Schema.TaggedError<StreamingError>(
  "open-insight/trajectory/StreamingError",
)("StreamingError", {
  cause: Schema.Defect(),
  message: Schema.optional(Schema.String),
}) {}

export const TrajectoryErrorReason = Schema.Union([
  EncodeError,
  DecodeError,
  SaveError,
  LoadError,
  StreamingError,
]);
export type TrajectoryErrorReason = Schema.Schema.Type<typeof TrajectoryErrorReason>;

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : undefined);

export class TrajectoryError extends Schema.TaggedError<TrajectoryError>(
  "open-insight/trajectory/TrajectoryError",
)("TrajectoryError", {
  reason: TrajectoryErrorReason,
}) {
  override get message(): string {
    return this.reason.message ?? this.reason._tag;
  }

  static encode = (cause: unknown) =>
    new TrajectoryError({ reason: new EncodeError({ message: errorMessage(cause) }) });

  static decode = (cause: unknown) =>
    new TrajectoryError({ reason: new DecodeError({ message: errorMessage(cause) }) });

  static save = (path: string) => new TrajectoryError({ reason: new SaveError({ path }) });

  static load = (path: string) => new TrajectoryError({ reason: new LoadError({ path }) });

  static partStream = (cause: unknown) =>
    new TrajectoryError({
      reason: new StreamingError({ cause, message: errorMessage(cause) }),
    });
}

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export const PartMetadata = Schema.Struct({
  uuid: Uuid,
  session: Schema.optional(Schema.String),
  extra: Schema.optional(Schema.Json),
});
export type PartMetadata = Schema.Schema.Type<typeof PartMetadata>;

export const PromptPart = Schema.TaggedStruct("Prompt", {
  messages: Schema.Array(Prompt.Message),
  ...PartMetadata.fields,
});
export type PromptPart = Schema.Schema.Type<typeof PromptPart>;
export type PromptPartEncoded = Schema.Codec.Encoded<typeof PromptPart>;
export const promptPart = (prompt: Prompt.Prompt): PromptPart =>
  PromptPart.make({ messages: prompt.content });

export const ResponsePart = <T extends Toolkit.Any>(toolkit: T) =>
  Schema.TaggedStruct("Response", {
    response: Response.PartView(toolkit),
    timestamp: Timestamp,
    ...PartMetadata.fields,
  });
export type ResponsePart<T extends Toolkit.Any> = Schema.Schema.Type<
  ReturnType<typeof ResponsePart<T>>
>;
export type ResponsePartEncoded = Schema.Codec.Encoded<ReturnType<typeof ResponsePart<any>>>;
export const AnyResponsePart = ResponsePart(Toolkit.empty);
export type AnyResponsePart = Schema.Schema.Type<typeof AnyResponsePart>;
export const responsePart = (response: Response.Part<any>): AnyResponsePart =>
  AnyResponsePart.make({ response });

export const Part = <Tools extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Tools>) =>
  Schema.Union([PromptPart, ResponsePart(toolkit)]);
export type Part<Tools extends Record<string, Tool.Any>> = Schema.Schema.Type<
  ReturnType<typeof Part<Tools>>
>;
export type PartEncoded = Schema.Codec.Encoded<ReturnType<typeof Part<any>>>;
export type AnyPart = PromptPart | AnyResponsePart;

export type PartStream<Tools extends Record<string, Tool.Any>> = Stream.Stream<
  Part<Tools>,
  TrajectoryError
>;
export type AnyPartStream = PartStream<Record<string, never>>;

export type Trajectory<Tools extends Record<string, Tool.Any>> = PartStream<Tools> &
  Readonly<{ toolkit: Toolkit.Toolkit<Tools>; metadata: Metadata }>;
export type Any = Trajectory<Record<string, never>>;
export type TrajectoryEncoded = Stream.Stream<PartEncoded, TrajectoryError>;

export const make = <Tools extends Record<string, Tool.Any>, E>(
  parts: Stream.Stream<Part<Tools>, E>,
  toolkit: Toolkit.Toolkit<Tools>,
  metadata: MetadataEncoded = {},
): Trajectory<Tools> =>
  Object.assign(parts.pipe(Stream.mapError(TrajectoryError.partStream)), {
    toolkit,
    metadata: Schema.decodeSync(Metadata)(metadata),
  });

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

export type ToolTurn<Tools extends Record<string, Tool.Any>> = {
  [Name in keyof Tools]: Name extends string
    ? Readonly<{
        call: Extract<Response.ToolCallParts<Tools>, { name: Name }>;
        result: Extract<Response.ToolResultParts<Tools>, { name: Name }>;
      }>
    : never;
}[keyof Tools];

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

export const metadata = Function.dual<
  <T extends Any>(metadata: Metadata) => (trajectory: T) => T,
  <T extends Any>(trajectory: T, metadata: Metadata) => T
>(2, <T extends Any>(trajectory: T, metadata: Metadata): T =>
  Object.assign(trajectory, { metadata }),
);

export type SessionTurn<Tools extends Record<string, Tool.Any>> = Readonly<{
  prompt: Prompt.Prompt;
  response: Response.PartView<Tools>[];
}>;
export type Session<Tools extends Record<string, Tool.Any>> = Stream.Stream<
  SessionTurn<Tools>,
  TrajectoryError
>;

const SessionEnd = Symbol("open-insight/trajectory/SessionEnd");
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

export type StreamSessionTurn<Tools extends Record<string, Tool.Any>, E> = Readonly<{
  prompt: Prompt.Prompt;
  response: Stream.Stream<Response.AllPartsView<Tools>, E>;
}>;
export type StreamSession<Tools extends Record<string, Tool.Any>, E> = Stream.Stream<
  StreamSessionTurn<Tools, E>,
  TrajectoryError
>;
export const fromSession = <Tools extends Record<string, Tool.Any>, E>(
  session: StreamSession<Tools, E>,
  toolkit: Toolkit.Toolkit<Tools>,
): PartStream<Tools> => {
  const responsePartSchema = ResponsePart(toolkit);

  return session.pipe(
    Stream.flatMap(({ prompt, response }) =>
      Stream.succeed(promptPart(prompt)).pipe(
        Stream.concat(
          response.pipe(
            fold,
            Stream.map((response) => responsePartSchema.make({ response })),
            Stream.mapError(TrajectoryError.partStream),
          ),
        ),
      ),
    ),
  );
};

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

export const finishPart: Sink.Sink<Option.Option<Response.FinishPart>, Part<any>> = Sink.reduce(
  () => Option.none<Response.FinishPart>(),
  (state, part) =>
    part._tag === "Response" && part.response.type === "finish"
      ? Option.some(part.response)
      : state,
);

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

export const usage = (
  trajectory: AnyPartStream,
): Effect.Effect<Option.Option<Response.Usage>, TrajectoryError> =>
  trajectory.pipe(
    Stream.run(finishPart),
    Effect.map((part) => Option.map(part, (p) => p.usage)),
  );

export const finishReason = (
  trajectory: AnyPartStream,
): Effect.Effect<Option.Option<Response.FinishReason>, TrajectoryError> =>
  trajectory.pipe(
    Stream.run(finishPart),
    Effect.map((part) => Option.map(part, (p) => p.reason)),
  );

export const responseMetadataParts = (
  trajectory: AnyPartStream,
): Stream.Stream<Response.ResponseMetadataPart, TrajectoryError> =>
  trajectory.pipe(toResponses).pipe(Stream.filter((part) => part.type === "response-metadata"));

export const persist = (path: string) =>
  Effect.fn(function* <Tools extends Record<string, Tool.Any>>(trajectory: Trajectory<Tools>) {
    const store = yield* NdjsonStore.NdjsonStore;
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
