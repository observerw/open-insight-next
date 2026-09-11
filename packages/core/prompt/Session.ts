import { Prompt } from "effect/unstable/ai";
import { Context, Effect, Layer, Option } from "effect";
import * as Sandox from "@/sandbox/mod.ts";

export type Session = Readonly<{
  init: Prompt.Prompt;
  next: (
    response: Prompt.Prompt,
  ) => Effect.Effect<Option.Option<Prompt.Prompt>, PromptError, Sandox.Sandbox>;
}>;

export type Provider = Readonly<{
  _tag: "Provider";
  runSession(sandbox: Sandox.Sandbox): Effect.Effect<Session, PromptError>;
}>;

type SessionOptions = Readonly<{
  init: Prompt.RawInput;
  next: (
    response: Prompt.Prompt,
  ) => Effect.Effect<Prompt.RawInput | null, PromptError, Sandox.Sandbox>;
}>;

export type Options = Readonly<{
  runSession(
    sandbox: Sandox.Sandbox,
  ): Effect.Effect<SessionOptions, PromptError>;
}>;

export const makeSession = ({ init, next }: SessionOptions) =>
  ({
    init: Prompt.make(init),
    next: Effect.fn(function* (response) {
      const nextPrompt = next?.(response) ?? Effect.succeed(null);
      return yield* nextPrompt.pipe(
        Effect.mapError(PromptError.generate),
        Effect.map(Option.fromNullOr),
        Effect.map(Option.map(Prompt.make)),
      );
    }),
  }) satisfies Session;

export const make = ({ runSession }: Options) =>
  ({
    _tag: "Provider" as const,
    runSession: Effect.fn(function* (sandbox) {
      const session = yield* runSession(sandbox).pipe(
        Effect.mapError(PromptError.generate),
      );
      return makeSession(session);
    }),
  }) satisfies Provider;

export const fromPrompt = (prompt: Prompt.RawInput) =>
  make({
    runSession: () =>
      Effect.succeed({
        init: prompt,
        next: () => Effect.succeed(null),
      }),
  });

export class Service
  extends Context.Service<Service, Provider>()("prompt/TurnsService") {}

export const layerFrom = (options: Options) =>
  Layer.succeed(Service, make(options));

export const layerFromPrompt = (prompt: Prompt.RawInput) =>
  Layer.succeed(Service, fromPrompt(prompt));
