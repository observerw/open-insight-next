import { Prompt, Sandbox } from "@open-insight/core";
import { Data, Effect, type Schema } from "effect";

export type RetryType = "continue" | "restart";

export class Retry extends Data.TaggedError("Retry")<{
  readonly type: RetryType;
  readonly prompt: Prompt.Prompt;
  readonly reason: string | null;
}> {}

export const retry = ({
  type,
  prompt,
  reason,
}: {
  type: RetryType;
  prompt: Prompt.Prompt;
  reason?: string | null;
}) => new Retry({ type, prompt, reason: reason ?? null });

export const mapError = (cause: unknown) =>
  cause instanceof Retry ? cause : GradeError.exec(cause);

export type EmbedContext = Sandbox.Sandbox;

export type EmbedExec<Result extends Schema.Constraint = any> = (
  ctx: EmbedContext,
) => Effect.Effect<Result["Type"], GradeError | Retry>;

export type EmbedGrader<Result extends Schema.Constraint = any> = EmbedExec<Result>;

export type EmbedOptions<Result extends Schema.Constraint = any> = Readonly<{
  grade: (ctx: EmbedContext) => Effect.Effect<Result["Type"], unknown | Retry>;
}>;

export const makeEmbed = <Result extends Schema.Constraint>({
  grade: gradeOption,
}: EmbedOptions<Result>) => {
  return (context: EmbedContext) =>
    gradeOption(context).pipe(
      Effect.mapError((err) => (err instanceof Retry ? err : GradeError.exec(err))),
    );
};
