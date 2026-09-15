import { Data, Effect, Option, RcMap, type Ref, Schema, type Scope, Stream } from "effect";
import * as Agent from "#/Agent.ts";
import * as Sandbox from "#/Sandbox.ts";
import type * as Response from "#/Response.ts";
import type * as Snapshot from "#/Snapshot.ts";
import type * as Prompt from "#/Prompt.ts";
import type { Tool, Toolkit } from "effect/unstable/ai";

export type HarnessError =
  | Schema.SchemaError
  | Agent.AgentError
  | Sandbox.ProviderError;

export type AgentSession<Tools extends Record<string, Tool.Any> = Record<string, never>> =
  Readonly<{
    trajectory: Ref.Ref<Prompt.Prompt>;
    prompt(prompt: Prompt.Prompt): Stream.Stream<Response.StreamPartView<Tools>, HarnessError>;
  }>;

const makeAgentSession = <Tools extends Record<string, Tool.Any>>(agent: Agent.Agent) =>
  ({
    trajectory: agent.trajectory,
    prompt: (prompt) => agent.prompt(prompt),
  }) satisfies AgentSession<Tools>;

export type SandboxSession<Tools extends Record<string, Tool.Any> = Record<string, never>> =
  Readonly<{
    sandbox: Sandbox.Sandbox["Service"];
    runAgent: () => Effect.Effect<AgentSession<Tools>, HarnessError, Scope.Scope>;
  }>;

export type SandboxSessionConfig = Readonly<{
  resources: Sandbox.Resources;
  cache: boolean;
}>;

export const DefaultSandboxSessionConfig: SandboxSessionConfig = {
  resources: Sandbox.makeResources({}),
  cache: true,
};

export class Metadata extends Schema.Class<Metadata>("HarnessMetadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}

type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export class Harness<ID extends string, Tools extends Record<string, Tool.Any>> extends Data.Class<{
  id: ID;
  metadata: Metadata;

  toolkit: Toolkit.Toolkit<Tools>;
  runSandbox(
    template: Snapshot.Template,
    options?: Partial<SandboxSessionConfig>,
  ): Effect.Effect<SandboxSession<Tools>, HarnessError, Scope.Scope>;
}> {}

export type Any = Harness<any, any>;

export type IDOf<H> = H extends Harness<infer ID, any> ? ID : never;

export type ToolkitOf<H> = H extends Harness<any, infer Tools> ? Toolkit.Toolkit<Tools> : never;

type Options = Omit<MetadataEncoded, "id"> & Readonly<{}>;

export const make = Effect.fn(function* <ID extends string, Tools extends Record<string, Tool.Any>>(
  id: ID,
  toolkit: Toolkit.Toolkit<Tools>,
  options: Options,
): Effect.fn.Return<
  Harness<ID, Tools>,
  HarnessError,
  Scope.Scope | Agent.ProviderService | Sandbox.SandboxProvider
> {
  const metadata = yield* Schema.decodeEffect(Metadata)({ id, ...options });

  const agentProvider = yield* Agent.ProviderService;
  const sandboxProvider = yield* Sandbox.SandboxProvider;

  const acquireSnapshot = (template: Snapshot.Template) =>
    sandboxProvider.acquireSnapshot({ template, cache: true });

  const extendSnapshot = (template: Snapshot.Template) => (snapshot: Snapshot.Snapshot) =>
    agentProvider.snapshotExtension.pipe(
      Option.match({
        onNone: () => Effect.succeed(snapshot),
        onSome: ({ instructions, context }) =>
          sandboxProvider.deriveSnapshot({
            snapshot,
            instructions,
            context: context ?? template.context,
            cache: true,
          }),
      }),
    );

  const makeSandboxSession = Effect.fn("HarnessService.makeSandboxSession")(function* ({
    snapshot,
    options,
  }: Readonly<{
    snapshot: Snapshot.Snapshot;
    options: Partial<SandboxSessionConfig> | undefined;
  }>) {
    const { resources = Sandbox.providerDefault, cache = true } = options ?? {};

    const sandbox = yield* sandboxProvider.runSandbox({ snapshot, resources, cache });

    const runAgent = Effect.fn(function* () {
      const agentSession = yield* agentProvider
        .runSession()
        .pipe(Effect.provideService(Sandbox.Sandbox, sandbox));
      return makeAgentSession(agentSession);
    }) satisfies SandboxSession<Tools>["runAgent"];

    return { sandbox, runAgent } satisfies SandboxSession<Tools>;
  });

  // RcMap keeps one acquired snapshot per equal template and releases it when unused.
  const cache = yield* RcMap.make({
    lookup: (template: Snapshot.Template) =>
      Effect.succeed(template).pipe(
        Effect.flatMap(acquireSnapshot),
        Effect.flatMap(extendSnapshot(template)),
      ),
  });

  const runSandbox = Effect.fn("HarnessService.runSandbox")(function* (template, options) {
    const snapshot = yield* RcMap.get(cache, template);

    return yield* makeSandboxSession({ snapshot, options });
  }) satisfies Harness<ID, Tools>["runSandbox"];

  return new Harness<ID, Tools>({ id, metadata, toolkit, runSandbox });
});
