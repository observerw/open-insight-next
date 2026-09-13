import { Schema } from "effect";

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

export const TrajectoryErrorReason = Schema.Union([EncodeError, DecodeError, PersistenceError]);

export type TrajectoryErrorReason = Schema.Schema.Type<typeof TrajectoryErrorReason>;

export class TrajectoryError extends Schema.TaggedError<TrajectoryError>(
  "open-insight/trajectory/TrajectoryError",
)("TrajectoryError", {
  reason: TrajectoryErrorReason,
}) {
  override get message(): string {
    return this.reason.message ?? this.reason._tag;
  }
}

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : undefined);

export const encodeError = (cause: unknown) =>
  new TrajectoryError({
    reason: new EncodeError({ message: errorMessage(cause) }),
  });

export const decodeError = (cause: unknown) =>
  new TrajectoryError({
    reason: new DecodeError({ message: errorMessage(cause) }),
  });

export const persistenceError = (operation: "save" | "load", path: string, cause: unknown) =>
  new TrajectoryError({
    reason: new PersistenceError({
      operation,
      path,
      message: errorMessage(cause),
    }),
  });
