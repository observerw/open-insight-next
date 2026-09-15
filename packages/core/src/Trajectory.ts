import { Effect, Function, Match, Option, Result, Schema, Sink, Stream, Tuple } from "effect";
import { type Tool, Toolkit } from "effect/unstable/ai";
import * as Prompt from "#/Prompt.ts";
import * as Response from "#/Response.ts";
import { Timestamp, Uuid } from "#/Schema.ts";

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

export class PersistenceError extends Schema.TaggedError<PersistenceError>(
  "open-insight/trajectory/PersistenceError",
)("PersistenceError", {
  operation: Schema.Union([Schema.Literal("save"), Schema.Literal("load")]),
  path: Schema.String,
  message: Schema.optional(Schema.String),
}) {}

export class StreamingError extends Schema.TaggedError<StreamingError>(
  "open-insight/trajectory/StreamingError",
)("StreamingError", {
  cause: Schema.Defect(),
  message: Schema.optional(Schema.String),
}) {}

export const TrajectoryErrorReason = Schema.Union([
  EncodeError,
  DecodeError,
  PersistenceError,
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

  static persistence = (operation: "save" | "load", path: string, cause: unknown) =>
    new TrajectoryError({
      reason: new PersistenceError({ operation, path, message: errorMessage(cause) }),
    });

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

export const session = <Tools extends Record<string, Tool.Any>>(
  trajectory: PartStream<Tools>,
): Session<Tools> => {
  throw new Error("not implemented");
};

export const toPrompt = <Tools extends Record<string, Tool.Any>>(
  trajectory: PartStream<Tools>,
): Effect.Effect<Prompt.Prompt, TrajectoryError> =>
  session(trajectory).pipe(
    Stream.runFold(
      () => Prompt.empty,
      (curr, { prompt, response }) =>
        Prompt.concat(curr, Prompt.concat(prompt, Prompt.fromResponseParts(response))),
    ),
  );

export const responses = <Tools extends Record<string, Tool.Any>>(
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
  trajectory.pipe(responses).pipe(Stream.filter((part) => part.type === "response-metadata"));
