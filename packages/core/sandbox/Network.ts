import { Context, Effect } from "effect";
import type { SandboxError } from "./SandboxError.ts";

export class Network extends Context.Service<
  Network,
  {
    expose(options: { sandboxPort: number }): Effect.Effect<URL, SandboxError>;
  }
>()("Network") {}

export const make = Effect.fn(function* () {});
