import { Prompt } from "effect/unstable/ai";
import { Effect, Option } from "effect";
import * as Sandbox from "#/Sandbox.ts";

export type Session<E = never> = Readonly<{
  init: Prompt.Prompt;
  next: (
    prompt: Prompt.Prompt,
    sandbox: Sandbox.Sandbox,
  ) => Effect.Effect<Option.Option<Prompt.Prompt>, E>;
}>;

export type SessionOptions<E = never> = Readonly<{
  init: Prompt.RawInput;
  next?: (
    prompt: Prompt.Prompt,
    sandbox: Sandbox.Sandbox,
  ) => Effect.Effect<Prompt.RawInput | null, E>;
}>;

export const makeSession = <E>({ init, next }: SessionOptions<E>): Session<E> => ({
  init: Prompt.make(init),
  next: Effect.fn(function* (prompt, sandbox) {
    const nextPrompt = next?.(prompt, sandbox) ?? Effect.succeed(null);
    return yield* nextPrompt.pipe(
      Effect.map(Option.fromNullOr),
      Effect.map(Option.map(Prompt.make)),
    );
  }),
});

export * from "effect/unstable/ai/Prompt";
