import { Prompt, Sandbox, Snapshot } from "@open-insight/core";
import { Data, Effect, Equal, flow, Match, Schema, Scope } from "effect";

export const GradeErrorReason = Schema.Union([Sandbox.SandboxError, Sandbox.SandboxProviderError]);
export type GradeErrorReason = Schema.Schema.Type<typeof GradeErrorReason>;

export class GradeError extends Schema.TaggedError<GradeError>("GradeError")("GradeError", {
  reason: GradeErrorReason,
}) {
  static sandbox = (error: Sandbox.SandboxError) => new GradeError({ reason: error });
  static sandboxProvider = (error: Sandbox.SandboxProviderError) =>
    new GradeError({ reason: error });
}

export class Retry extends Data.TaggedError("Retry")<{
  readonly type: "continue" | "restart";
  readonly prompt: Prompt.Prompt;
  readonly reason: string | null;
}> {}

type EmbedExec<Result extends Schema.Constraint> = (
  ctx: Sandbox.Sandbox,
) => Effect.Effect<Result["Type"], GradeError | Retry>;
export type EmbedTemplate<Result extends Schema.Constraint> = Readonly<{
  schema: Result;
  exec: EmbedExec<Result>;
  verif?: Verifier<Result>;
}>;

export type SandboxScope = "per-task" | "per-trail";

type SidecarExec<Result extends Schema.Constraint> = (
  ctx: Sandbox.Sandbox &
    Readonly<{
      /** The sandbox in which the agent performed the task. */
      agent: Sandbox.Sandbox;
    }>,
) => Effect.Effect<Result["Type"], GradeError | Retry>;
export type SidecarTemplate<Result extends Schema.Constraint = any> = Readonly<{
  schema: Result;
  exec: SidecarExec<Result>;
  snapshot: Snapshot.Template;
  resources: Sandbox.Resources;
  scope: SandboxScope;
  concurrency: number;
  verif?: Verifier<Result>;
}>;

export type Template<Result extends Schema.Constraint> =
  | (EmbedTemplate<Result> & { _tag: "Embed" })
  | (SidecarTemplate<Result> & { _tag: "SidecarPerTask" })
  | (SidecarTemplate<Result> & { _tag: "SidecarPerTrail" });

export const makeEmbed = <Result extends Schema.Constraint>(
  schema: Result,
  exec: EmbedExec<Result>,
  verif?: Verifier<Result>,
): Template<Result> => ({ _tag: "Embed" as const, schema, exec, verif });

export const makeSidecar = <Result extends Schema.Constraint>(
  schema: Result,
  exec: SidecarExec<Result>,
  {
    snapshot = Snapshot.Alpine,
    resources = Sandbox.providerDefault,
    scope = "per-trail",
    concurrency = 1,
    verif,
  }: {
    snapshot?: Snapshot.Template;
    resources?: Sandbox.Resources;
    scope?: SandboxScope;
    concurrency?: number;
    verif?: Verifier<Result>;
  } = {},
): Template<Result> => {
  const _tag = Match.value(scope).pipe(
    Match.when("per-task", () => "SidecarPerTask" as const),
    Match.when("per-trail", () => "SidecarPerTrail" as const),
    Match.exhaustive,
  );
  return { _tag, schema, exec, snapshot, resources, scope, concurrency, verif };
};

export type GradeSession<Result extends Schema.Constraint> = Effect.Effect<
  Result["Type"],
  GradeError | Retry
>;
export type Grader<Result extends Schema.Constraint> = Readonly<{
  runSession(
    agentSbx: Sandbox.Sandbox,
  ): Effect.Effect<GradeSession<Result>, GradeError, Scope.Scope>;
}>;

export const run = Effect.fn("Grade.make")(function* <Result extends Schema.Constraint>(
  template: Template<Result>,
) {
  const sbxProvider = yield* Sandbox.SandboxProvider;

  switch (template._tag) {
    case "Embed": {
      return {
        runSession: Effect.fn(function* (agentSbx) {
          return template.exec(agentSbx);
        }),
      } satisfies Grader<Result>;
    }
    case "SidecarPerTask": {
      const { snapshot: snapshotTemplate, resources, exec } = template;
      const snapshot = yield* sbxProvider.acquireSnapshot({
        template: snapshotTemplate,
        cache: true,
      });
      return {
        runSession: Effect.fn(function* (agentSbx) {
          const gradeSbx = yield* sbxProvider
            .runSandbox({ snapshot, resources })
            .pipe(Effect.mapError(GradeError.sandboxProvider));
          return exec(Object.assign(gradeSbx, { agent: agentSbx }));
        }),
      } satisfies Grader<Result>;
    }
    case "SidecarPerTrail": {
      const { snapshot: snapshotTemplate, resources, exec } = template;

      return {
        runSession: Effect.fn(function* (agentSbx) {
          const snapshot = yield* sbxProvider
            .acquireSnapshot({ template: snapshotTemplate })
            .pipe(Effect.mapError(GradeError.sandboxProvider));
          const gradeSbx = yield* sbxProvider
            .runSandbox({ snapshot, resources })
            .pipe(Effect.mapError(GradeError.sandboxProvider));
          return exec(Object.assign(gradeSbx, { agent: agentSbx }));
        }),
      } satisfies Grader<Result>;
    }
  }
});

export type Verifier<Result extends Schema.Constraint> = Readonly<{
  exec: (sandbox: Sandbox.Sandbox) => Effect.Effect<Prompt.Prompt, GradeError>;
  expect: Partial<Result["Type"]>;
}>;
export const makeVerifier = <Result extends Schema.Constraint>(
  exec: (sandbox: Sandbox.Sandbox) => Effect.Effect<Prompt.RawInput, GradeError>,
  expect: Partial<Result["Type"]>,
): Verifier<Result> => ({ exec: flow(exec, Effect.map(Prompt.make)), expect });

export const isMatch = <Result extends Schema.Constraint>({
  result,
  expect,
}: Readonly<{
  expect: Partial<Result["Type"]>;
  result: Result["Type"];
}>) => Equal.equals(result, Object.assign({}, result, expect));
