import { Effect, identity, Predicate, Schema, SchemaTransformation } from "effect";
import type { Tool, Toolkit } from "effect/unstable/ai";
import {
  AllParts,
  makePart,
  Part,
  ProviderMetadata,
  StreamPart,
  toolResultPart,
} from "effect/unstable/ai/Response";
import type {
  AllPartsEncoded,
  ConstructorParams,
  PartEncoded,
  StreamPartEncoded,
  ToolCallPart,
  ToolCallPartEncoded,
  ToolCallParts,
  ToolParametersMode,
  ToolResultPart,
  ToolResultPartEncoded,
  ToolResultParts,
} from "effect/unstable/ai/Response";

const PartTypeId = "~effect/ai/Content/Part" as const;

const AnyToolCallPartTypeId = "~effect/ai/Content/AnyToolCallPart" as const;

const AnyToolResultPartTypeId = "~effect/ai/Content/AnyToolResultPart" as const;

// =============================================================================
// All Parts
// =============================================================================

/**
 * Union type for all response parts that also accepts tools outside the
 * provided toolkit.
 *
 * @see {@link AllParts} for toolkit-specific response parts.
 * @category models
 */
export type AllPartsView<Tools extends Record<string, Tool.Any>> =
  | AllParts<Tools>
  | AnyToolCallPart
  | AnyToolResultPart;

/**
 * Creates a Schema for all response parts, including tools outside the provided
 * toolkit.
 *
 * @see {@link AllParts} for a Schema restricted to the provided toolkit.
 * @category schemas
 */
export const AllPartsView = <T extends Toolkit.Any | Toolkit.WithHandler<any>>(
  toolkit: T,
): Schema.Codec<
  AllPartsView<T extends Toolkit.Any ? Toolkit.Tools<T> : Toolkit.WithHandlerTools<T>>,
  AllPartsEncoded,
  Tool.ResultDecodingServices<Toolkit.Tools<T>[keyof Toolkit.Tools<T>]>,
  Tool.ResultEncodingServices<Toolkit.Tools<T>[keyof Toolkit.Tools<T>]>
> => withAnyToolParts(AllParts(toolkit), toolkit) as any;

// =============================================================================
// Parts
// =============================================================================

/**
 * Union type for non-streaming response parts that also accepts tools outside
 * the provided toolkit.
 *
 * @see {@link Part} for toolkit-specific non-streaming response parts.
 * @category models
 */
export type PartView<
  Tools extends Record<string, Tool.Any>,
  EncodedToolParameters extends ToolParametersMode = "decoded",
> = Part<Tools, EncodedToolParameters> | AnyToolCallPart | AnyToolResultPart;

/**
 * Creates a Schema for non-streaming response parts, including tools outside the
 * provided toolkit.
 *
 * @see {@link Part} for a Schema restricted to the provided toolkit.
 * @category schemas
 */
export const PartView = <T extends Toolkit.Any | Toolkit.WithHandler<any>>(
  toolkit: T,
): Schema.Codec<
  PartView<T extends Toolkit.Any ? Toolkit.Tools<T> : Toolkit.WithHandlerTools<T>>,
  PartEncoded,
  Tool.ResultDecodingServices<Toolkit.Tools<T>[keyof Toolkit.Tools<T>]>,
  Tool.ResultEncodingServices<Toolkit.Tools<T>[keyof Toolkit.Tools<T>]>
> => withAnyToolParts(Part(toolkit), toolkit) as any;

// =============================================================================
// Stream Parts
// =============================================================================

/**
 * Union type for streaming response parts that also accepts tools outside the
 * provided toolkit.
 *
 * @see {@link StreamPart} for toolkit-specific streaming response parts.
 * @category models
 */
export type StreamPartView<
  Tools extends Record<string, Tool.Any>,
  EncodedToolParameters extends ToolParametersMode = "decoded",
> = StreamPart<Tools, EncodedToolParameters> | AnyToolCallPart | AnyToolResultPart;

/**
 * Creates a Schema for streaming response parts, including tools outside the
 * provided toolkit.
 *
 * @see {@link StreamPart} for a Schema restricted to the provided toolkit.
 * @category schemas
 */
export const StreamPartView = <T extends Toolkit.Any | Toolkit.WithHandler<any>>(
  toolkit: T,
): Schema.Codec<
  StreamPartView<T extends Toolkit.Any ? Toolkit.Tools<T> : Toolkit.WithHandlerTools<T>>,
  StreamPartEncoded,
  Tool.ResultDecodingServices<Toolkit.Tools<T>[keyof Toolkit.Tools<T>]>,
  Tool.ResultEncodingServices<Toolkit.Tools<T>[keyof Toolkit.Tools<T>]>
> => withAnyToolParts(StreamPart(toolkit), toolkit) as any;

// =============================================================================
// utility types
// =============================================================================

/**
 * Union type for tool call parts that also accepts tools outside the provided
 * toolkit.
 *
 * @see {@link ToolCallParts} for toolkit-specific tool call parts.
 * @category utility types
 */
export type ToolCallPartsView<
  Tools extends Record<string, Tool.Any>,
  EncodedParameters extends ToolParametersMode = "decoded",
> = ToolCallParts<Tools, EncodedParameters> | AnyToolCallPart;

/**
 * Union type for tool result parts that also accepts tools outside the provided
 * toolkit.
 *
 * @see {@link ToolResultParts} for toolkit-specific tool result parts.
 * @category utility types
 */
export type ToolResultPartsView<Tools extends Record<string, Tool.Any>> =
  | ToolResultParts<Tools>
  | AnyToolResultPart;

// =============================================================================
// Tool Call Part
// =============================================================================

/**
 * Tool call part whose name and parameters are not restricted by a toolkit.
 *
 * @category models
 */
export type AnyToolCallPart = ToolCallPart<string, unknown>;

type RuntimeAnyToolCallPart = AnyToolCallPart & {
  readonly [AnyToolCallPartTypeId]: typeof AnyToolCallPartTypeId;
};

/**
 * Type guard to check if a value is an unrestricted tool call part.
 *
 * @category guards
 */
export const isAnyToolCallPart = (u: unknown): u is RuntimeAnyToolCallPart =>
  Predicate.hasProperty(u, AnyToolCallPartTypeId);

/**
 * Constructs a tool call part whose name and parameters are unrestricted.
 *
 * @category constructors
 */
export const anyToolCallPart = (
  params: ConstructorParams<ToolCallPart<string, unknown>>,
): AnyToolCallPart =>
  Object.assign(makePart("tool-call", params), {
    [AnyToolCallPartTypeId]: AnyToolCallPartTypeId,
  });

/**
 * Schema for a tool call whose name and parameters are not restricted by a
 * toolkit.
 *
 * @category schemas
 */
export const AnyToolCallPart: Schema.Codec<AnyToolCallPart, ToolCallPartEncoded> = (() => {
  const Decoded = Schema.Struct({
    type: Schema.Literal("tool-call"),
    id: Schema.String,
    name: Schema.String,
    params: Schema.Unknown,
    providerExecuted: Schema.Boolean,
    metadata: ProviderMetadata,
    [PartTypeId]: Schema.Literal(PartTypeId),
    [AnyToolCallPartTypeId]: Schema.Literal(AnyToolCallPartTypeId).pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(AnyToolCallPartTypeId), {
        encodingStrategy: "omit",
      }),
    ),
  });

  const Encoded = Schema.Struct({
    type: Schema.Literal("tool-call"),
    id: Schema.String,
    name: Schema.String,
    params: Schema.Unknown,
    providerExecuted: Schema.optional(Schema.Boolean),
    metadata: Schema.optional(ProviderMetadata),
  });

  return Decoded.pipe(
    Schema.encodeTo(
      Encoded,
      SchemaTransformation.transform({
        decode: (encoded) => ({
          ...encoded,
          [PartTypeId]: PartTypeId,
          providerExecuted: encoded.providerExecuted ?? false,
          metadata: encoded.metadata ?? {},
        }),
        encode: identity,
      }),
    ),
  ).annotate({ identifier: "AnyToolCallPart" }) as any;
})();

// =============================================================================
// Tool Call Result Part
// =============================================================================

/**
 * Tool result part whose name and result are not restricted by a toolkit.
 *
 * @category models
 */
export type AnyToolResultPart = ToolResultPart<string, unknown, unknown>;

type RuntimeAnyToolResultPart = AnyToolResultPart & {
  readonly [AnyToolResultPartTypeId]: typeof AnyToolResultPartTypeId;
};

/**
 * Type guard to check if a value is an unrestricted tool result part.
 *
 * @category guards
 */
export const isAnyToolResultPart = (u: unknown): u is RuntimeAnyToolResultPart =>
  Predicate.hasProperty(u, AnyToolResultPartTypeId);

/**
 * Union of unrestricted tool call and tool result parts.
 *
 * @category models
 */
export type AnyToolPart = AnyToolCallPart | AnyToolResultPart;

type RuntimeAnyToolPart = RuntimeAnyToolCallPart | RuntimeAnyToolResultPart;

/**
 * Type guard to check if a value is an unrestricted tool part.
 *
 * @category guards
 */
export const isAnyToolPart = (u: unknown): u is RuntimeAnyToolPart =>
  Predicate.hasProperty(u, AnyToolCallPartTypeId) ||
  Predicate.hasProperty(u, AnyToolResultPartTypeId);

/**
 * Constructs a tool result part whose name and result are unrestricted.
 *
 * @category constructors
 */
export const anyToolResultPart = <
  const Params extends ConstructorParams<ToolResultPart<string, unknown, unknown>>,
>(
  params: Params,
): AnyToolResultPart =>
  Object.assign(toolResultPart(params), {
    [AnyToolResultPartTypeId]: AnyToolResultPartTypeId,
  });

/**
 * Schema for a tool result whose name and result are not restricted by a
 * toolkit.
 *
 * @category schemas
 */
export const AnyToolResultPart: Schema.Codec<AnyToolResultPart, ToolResultPartEncoded> = (() => {
  const Common = {
    id: Schema.String,
    type: Schema.Literal("tool-result"),
    isFailure: Schema.Boolean,
    name: Schema.String,
  };

  const Decoded = Schema.Struct({
    ...Common,
    [PartTypeId]: Schema.Literal(PartTypeId),
    [AnyToolResultPartTypeId]: Schema.Literal(AnyToolResultPartTypeId).pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(AnyToolResultPartTypeId), {
        encodingStrategy: "omit",
      }),
    ),
    result: Schema.Unknown,
    providerExecuted: Schema.Boolean,
    metadata: ProviderMetadata,
    encodedResult: Schema.Unknown,
    preliminary: Schema.Boolean,
  });

  const Encoded = Schema.Struct({
    ...Common,
    result: Schema.Unknown,
    providerExecuted: Schema.optional(Schema.Boolean),
    metadata: Schema.optional(ProviderMetadata),
    preliminary: Schema.optional(Schema.Boolean),
  });

  return Decoded.pipe(
    Schema.encodeTo(
      Encoded,
      SchemaTransformation.transform({
        decode: (encoded) => ({
          ...encoded,
          [PartTypeId]: PartTypeId,
          providerExecuted: encoded.providerExecuted ?? false,
          metadata: encoded.metadata ?? {},
          encodedResult: encoded.result,
          preliminary: encoded.preliminary ?? false,
        }),
        encode: identity,
      }),
    ),
  ).annotate({ identifier: "AnyToolResultPart" }) as any;
})();

// =============================================================================
// internal
// =============================================================================

const withAnyToolParts = (
  schema: Schema.Top,
  toolkit: Toolkit.Any | Toolkit.WithHandler<any>,
): Schema.Top => {
  const toolNames = new Set(
    Object.values(toolkit.tools as Record<string, Tool.Any>).map((tool) => tool.name),
  );

  const unknownTool = <S extends Schema.Top>(part: S): S =>
    toolNames.size === 0
      ? part
      : (part.pipe(
          Schema.check(
            Schema.makeFilter((value: S["Type"]) =>
              toolNames.has((value as { readonly name: string }).name)
                ? "tool name is already defined in the toolkit"
                : undefined,
            ),
          ),
        ) as S);

  return Schema.Union([schema, unknownTool(AnyToolCallPart), unknownTool(AnyToolResultPart)]);
};
