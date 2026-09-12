import type { QuitError, UserInput } from "effect/Terminal";
import { type Cause, Context, type Effect, type Queue, type Scope } from "effect";
import type { SandboxError } from "./SandboxError.ts";

export class Terminal extends Context.Service<
  Terminal,
  {
    readonly columns: Effect.Effect<number>;
    readonly rows: Effect.Effect<number>;
    readonly readInput: Effect.Effect<Queue.Dequeue<UserInput, Cause.Done>, never, Scope.Scope>;
    readonly readLine: Effect.Effect<string, QuitError>;
    readonly display: (text: string) => Effect.Effect<void, SandboxError>;
  }
>()("open-insight/sandbox/Terminal") {}
