import { Effect, Function, Schema, Stream, Tuple } from "effect";
import { Prompt, type Tool, Toolkit } from "effect/unstable/ai";
import * as Response from "#/response/index.ts";
import { Timestamp, Uuid } from "#/utils/Schema.ts";
import * as TrajectoryError from "./TrajectoryError.ts";

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export const PromptPart = Schema.TaggedStruct("Prompt", {
  messages: Schema.Array(Prompt.Message),
});
export type PromptPart = Schema.Schema.Type<typeof PromptPart>;
export type PromptPartEncoded = Schema.Codec.Encoded<typeof PromptPart>;

export const ResponsePart = <T extends Toolkit.Any>(toolkit: T) =>
  Schema.TaggedStruct("Response", {
    response: Response.PartView(toolkit),
    timestamp: Timestamp,
  });
export type ResponsePart<T extends Toolkit.Any> = Schema.Schema.Type<
  ReturnType<typeof ResponsePart<T>>
>;
export type ResponsePartEncoded = Schema.Codec.Encoded<ReturnType<typeof ResponsePart<any>>>;

export const PartMetadata = Schema.Struct({
  uuid: Uuid,
  session: Schema.optional(Schema.String),
  extra: Schema.optional(Schema.Json),
});
export type PartMetadata = Schema.Schema.Type<typeof PartMetadata>;

export const Part = <Tools extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Tools>) =>
  Schema.Union([PromptPart, ResponsePart(toolkit)]).mapMembers(
    Tuple.map(Schema.fieldsAssign(PartMetadata.fields)),
  );
export type Part<Tools extends Record<string, Tool.Any>> = Schema.Schema.Type<
  ReturnType<typeof Part<Tools>>
>;
export type PartEncoded = Schema.Codec.Encoded<ReturnType<typeof Part<any>>>;
export type AnyPart = Part<any>;

export type PartStream<Tools extends Record<string, Tool.Any>> = Stream.Stream<
  Part<Tools>,
  TrajectoryError.TrajectoryError
>;
export type AnyPartStream = PartStream<Record<string, never>>;

/**
 * A trajectory represents a sequence of turns in a conversation, where each turn consists of a prompt and the corresponding response.
 */
export type Trajectory<Tools extends Record<string, Tool.Any>> = PartStream<Tools> &
  Readonly<{ toolkit: Toolkit.Toolkit<Tools>; metadata: Metadata }>;
export type Any = Trajectory<Record<string, never>>;
export type TrajectoryEncoded = Stream.Stream<PartEncoded, TrajectoryError.TrajectoryError>;

export const encode = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Effect.fn.Return<
  TrajectoryEncoded,
  TrajectoryError.TrajectoryError,
  Tool.ResultEncodingServices<Tools[keyof Tools]>
> {
  const partSchema = Part(trajectory.toolkit);
  const encodingContext = yield* Effect.context<typeof partSchema.EncodingServices>();
  const encodePart = Schema.encodeEffect(partSchema);

  return trajectory.pipe(
    Stream.mapEffect((part) =>
      encodePart(part).pipe(
        Effect.mapError(TrajectoryError.encodeError),
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
        Effect.mapError(TrajectoryError.decodeError),
        Effect.provideContext(decodingContext),
      ),
    ),
  );

  return Object.assign(parts, { toolkit }) as Trajectory<Toolkit.MergedTools<Toolkits>>;
});

/**
 * Overrides the metadata of a trajectory with the given metadata.
 */
export const metadata = Function.dual<
  <T extends Any>(metadata: Metadata) => (trajectory: T) => T,
  <T extends Any>(trajectory: T, metadata: Metadata) => T
>(2, <T extends Any>(trajectory: T, metadata: Metadata): T =>
  Object.assign(trajectory, { metadata }),
);
