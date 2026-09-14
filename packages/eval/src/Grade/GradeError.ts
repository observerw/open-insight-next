import { Sandbox } from "@open-insight/core";
import { Schema } from "effect";

export const GradeErrorReason = Schema.Union([Sandbox.SandboxError.SandboxError]);
export type GradeErrorReason = Schema.Schema.Type<typeof GradeErrorReason>;

export class GradeError extends Schema.TaggedError<GradeError>("GradeError")("GradeError", {
  reason: GradeErrorReason,
}) {
  static sandbox = (error: Sandbox.SandboxError.SandboxError) => new GradeError({ reason: error });
}
