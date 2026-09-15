import * as Prompt from "#/Prompt.ts";
import type * as Response from "#/Response.ts";
import type * as Sandbox from "#/Sandbox.ts";
import type * as Snapshot from "#/Snapshot.ts";
import { Context, Effect, Layer, Option, Ref, Schema, type Scope, Semaphore, Stream } from "effect";

export class AgentError extends Schema.TaggedError<AgentError>("open-insight/AgentError")(
  "AgentError",
  {
    cause: Schema.Defect(),
  },
) {}

export type Agent = Readonly<{
  /**
   * Ref of an append- and read-only view of the prompt trajectory, including
   * all prompts and responses that have been streamed so far.
   *
   * Note that this trajectory may not equate to the internal state of the agent.
   */
  trajectory: Ref.Ref<Prompt.Prompt>;

  /**
   * Sends a prompt to the agent and returns a stream of response parts.
   */
  prompt(prompt: Prompt.Prompt): Stream.Stream<Response.StreamPartView<{}>, AgentError>;
}>;

export type SnapshotExtension = Readonly<{
  instructions: Snapshot.Instructions;
  context?: string;
}>;

export class Provider extends Context.Service<
  Provider,
  {
    snapshotExtension: Option.Option<SnapshotExtension>;
    runSession(sandbox: Sandbox.Sandbox): Effect.Effect<Agent, AgentError, Scope.Scope>;
  }
>()("agent/AgentService") {}

type AgentOptions = Readonly<{
  prompt(prompt: Prompt.Prompt): Stream.Stream<Response.StreamPartView<{}>, AgentError>;
}>;

type ProviderOptions = Readonly<{
  snapshotExtension?: SnapshotExtension;
  runSession(sandbox: Sandbox.Sandbox): Effect.Effect<AgentOptions, AgentError, Scope.Scope>;
}>;

const makeAgent = Effect.fn("Agent.makeAgent")(function* ({
  prompt: promptFn,
}: AgentOptions): Effect.fn.Return<Agent, AgentError> {
  const trajectory = yield* Ref.make<Prompt.Prompt>(Prompt.empty);
  const promptSem = Semaphore.makeUnsafe(1);

  const prompt = Effect.fn(function* (prompt: Prompt.Prompt) {
    yield* promptSem.take(1);

    const current = yield* Ref.get(trajectory);
    const nextTrajectory = Prompt.concat(current, prompt);

    const parts: Array<Response.AnyPart> = [];

    const finalize = Effect.gen(function* () {
      yield* Ref.set(trajectory, Prompt.concat(nextTrajectory, Prompt.fromResponseParts(parts)));
      yield* promptSem.release(1);
    });

    return promptFn(nextTrajectory).pipe(
      Stream.tap(
        Effect.fn(function* (part) {
          parts.push(part);
        }),
      ),
      Stream.ensuring(finalize),
    );
  }, Stream.unwrap);

  return { trajectory, prompt } satisfies Agent;
});

export const make = ({ snapshotExtension, runSession }: ProviderOptions): Provider["Service"] => ({
  snapshotExtension: Option.fromNullishOr(snapshotExtension),
  runSession: (sandbox) => runSession(sandbox).pipe(Effect.flatMap(makeAgent)),
});

export const layerFrom = (options: ProviderOptions): Layer.Layer<Provider> =>
  Layer.succeed(Provider, make(options));
