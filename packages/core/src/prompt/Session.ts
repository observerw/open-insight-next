import { Prompt } from "effect/unstable/ai";
import { Context, Effect, Layer, Option } from "effect";
import type * as Sandox from "#/sandbox/index.ts";

export type Session<E = never> = Readonly<{
  init: Prompt.Prompt;
  next: (response: Prompt.Prompt) => Effect.Effect<Option.Option<Prompt.Prompt>, E, Sandox.Sandbox>;
}>;

export type Provider<E = never> = Readonly<{
  _tag: "Provider";
  runSession(sandbox: Sandox.Sandbox): Effect.Effect<Session<E>, E>;
}>;

type SessionOptions<E = never> = Readonly<{
  init: Prompt.RawInput;
  next: (response: Prompt.Prompt) => Effect.Effect<Prompt.RawInput | null, E, Sandox.Sandbox>;
}>;

export type Options<E = never> = Readonly<{
  runSession(sandbox: Sandox.Sandbox): Effect.Effect<SessionOptions<E>, E>;
}>;

export const makeSession = <E>({ init, next }: SessionOptions<E>) =>
  ({
    init: Prompt.make(init),
    next: Effect.fn(function* (response) {
      const nextPrompt = next?.(response) ?? Effect.succeed(null);

      return yield* nextPrompt.pipe(
        Effect.map(Option.fromNullOr),
        Effect.map(Option.map(Prompt.make)),
      );
    }),
  }) satisfies Session<E>;

export const make = <E>({ runSession }: Options<E>) =>
  ({
    _tag: "Provider" as const,
    runSession: Effect.fn(function* (sandbox) {
      const session = yield* runSession(sandbox);

      return makeSession(session);
    }),
  }) satisfies Provider<E>;

export const fromPrompt = (prompt: Prompt.RawInput) =>
  make({
    runSession: () =>
      Effect.succeed({
        init: prompt,
        next: () => Effect.succeed(null),
      }),
  });

export class Service extends Context.Service<Service, Provider>()("prompt/TurnsService") {}

export const layerFrom = (options: Options) => Layer.succeed(Service, make(options));

export const layerFromPrompt = (prompt: Prompt.RawInput) =>
  Layer.succeed(Service, fromPrompt(prompt));
