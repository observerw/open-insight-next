import { Prompt, Sandbox, Snapshot } from "@open-insight/core";
import { Data, Effect, Match, Scope, type Schema } from "effect";
import type { GradeError } from "./GradeError.ts";

export class Retry extends Data.TaggedError("Retry")<{
  readonly type: "continue" | "restart";
  readonly prompt: Prompt.Prompt;
  readonly reason: string | null;
}> {}

type EmbedExec<Result extends Schema.Constraint> = (
  ctx: Sandbox.SandboxService,
) => Effect.Effect<Result["Type"], GradeError | Retry>;
export type EmbedTemplate<Result extends Schema.Constraint> = Readonly<{
  exec: EmbedExec<Result>;
}>;

export type SandboxScope = "per-task" | "per-trail";

type SidecarExec<Result extends Schema.Constraint> = (
  ctx: Sandbox.SandboxService &
    Readonly<{
      /** The sandbox in which the agent performed the task. */
      agent: Sandbox.SandboxService;
    }>,
) => Effect.Effect<Result["Type"], GradeError | Retry>;
export type SidecarTemplate<Result extends Schema.Constraint = any> = Readonly<{
  exec: SidecarExec<Result>;
  snapshot: Snapshot.Template;
  resources: Sandbox.Resources.Resources;
  scope: SandboxScope;
  concurrency: number;
}>;

export type Template<Result extends Schema.Constraint> =
  | (EmbedTemplate<Result> & { _tag: "Embed" })
  | (SidecarTemplate<Result> & { _tag: "SidecarPerTask" })
  | (SidecarTemplate<Result> & { _tag: "SidecarPerTrail" });

export const makeEmbed = <Result extends Schema.Constraint>(
  exec: EmbedExec<Result>,
): Template<Result> => ({ _tag: "Embed" as const, exec });

export const makeSidecar = <Result extends Schema.Constraint>(
  exec: SidecarExec<Result>,
  {
    snapshot = Snapshot.Alpine,
    resources = Sandbox.Resources.providerDefault,
    scope = "per-trail",
    concurrency = 1,
  }: {
    snapshot?: Snapshot.Template;
    resources?: Sandbox.Resources.Resources;
    scope?: SandboxScope;
    concurrency?: number;
  } = {},
): Template<Result> => {
  const _tag = Match.value(scope).pipe(
    Match.when("per-task", () => "SidecarPerTask" as const),
    Match.when("per-trail", () => "SidecarPerTrail" as const),
    Match.exhaustive,
  );
  return { _tag, exec, snapshot, resources, scope, concurrency };
};

export type GradeSession<Result extends Schema.Constraint> = Effect.Effect<
  Result["Type"],
  GradeError | Retry
>;
export type Grader<Result extends Schema.Constraint> = Readonly<{
  runSession(
    agentSbx: Sandbox.SandboxService,
  ): Effect.Effect<GradeSession<Result>, GradeError, Scope.Scope>;
}>;

export const run = Effect.fn("Grade.make")(function* <Result extends Schema.Constraint>(
  template: Template<Result>,
) {
  const sbxProvider = yield* Sandbox.SandboxProvider.SandboxProvider;

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
          const gradeSbx = yield* sbxProvider.runSandbox({ snapshot, resources });
          return exec(Object.assign(gradeSbx, { agent: agentSbx }));
        }),
      } satisfies Grader<Result>;
    }
    case "SidecarPerTrail": {
      const { snapshot: snapshotTemplate, resources, exec } = template;

      return {
        runSession: Effect.fn(function* (agentSbx) {
          const snapshot = yield* sbxProvider.acquireSnapshot({ template: snapshotTemplate });
          const gradeSbx = yield* sbxProvider.runSandbox({ snapshot, resources });
          return exec(Object.assign(gradeSbx, { agent: agentSbx }));
        }),
      } satisfies Grader<Result>;
    }
  }
});
