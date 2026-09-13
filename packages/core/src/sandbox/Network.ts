import { Context, Effect } from "effect";
import type { NetworkPolicy } from "./NetworkPolicy.ts";
import type { SandboxError } from "./SandboxError.ts";

export class Network extends Context.Service<
  Network,
  {
    /**
     * Exposes a sandbox port and returns a URL that can be used to access it from the host machine.
     */
    readonly expose: (options: { sandboxPort: number }) => Effect.Effect<URL, SandboxError>;

    /** Applies a network policy to the sandbox. */
    readonly apply: (policy: NetworkPolicy) => Effect.Effect<void, SandboxError>;
  }
>()("Network") {}

export const make = Effect.fn(function* () {});
