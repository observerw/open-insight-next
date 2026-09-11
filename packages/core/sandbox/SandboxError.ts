import { Schema } from "effect";

export class ConnectionError
  extends Schema.TaggedError<ConnectionError>()("ConnectionError", {
    cause: Schema.Defect(),
  }) {}

export class OperationFailed extends Schema.TaggedError<OperationFailed>(
  "open-insight/sandbox/SandboxError/OperationFailed",
)("OperationFailed", {
  cause: Schema.Defect(),
  message: Schema.optional(Schema.String),
  operation: Schema.optional(Schema.String),
}) {}

export const SandboxErrorReason = Schema.Union([
  ConnectionError,
  OperationFailed,
]);

export class SandboxError
  extends Schema.TaggedError<SandboxError>()("SandboxError", {
    reason: SandboxErrorReason,
  }) {}

export const operationFailed = (
  operation?: string,
  message?: string,
) =>
(cause: unknown) =>
  new SandboxError({
    reason: new OperationFailed({ cause, message, operation }),
  });
