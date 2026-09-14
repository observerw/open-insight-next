import { Context, Effect } from "effect";
import type { SandboxError } from "./SandboxError.ts";

export class Storage extends Context.Service<
  Storage,
  {
    createVolume: (
      name: string,
      options?: {
        sizeMiB: number;
      },
    ) => Effect.Effect<void, SandboxError>;

    removeVolume: (name: string) => Effect.Effect<void, SandboxError>;

    mount: (args: {
      volume: string;
      sandbox: string;
      path: string;
    }) => Effect.Effect<void, SandboxError>;

    unmount: (args: { volume: string; sandbox: string }) => Effect.Effect<void, SandboxError>;
  }
>()("Storage") {}
