import { Context, Effect, Layer } from "effect";

export * as SandboxError from "./SandboxError.ts";
export * as SandboxProvider from "./SandboxProvider.ts";
export * as SandboxFileSystem from "./FileSystem.ts";
export * as SandboxProcess from "./SandboxProcess.ts";
export * as SandboxNetwork from "./Network.ts";
export * as SandboxTerminal from "./Terminal.ts";
export * as NetworkPolicy from "./NetworkPolicy.ts";
export * as Resources from "./Resources.ts";
import { FileSystem } from "./FileSystem.ts";
import { Process } from "./Process.ts";
import { Terminal } from "./Terminal.ts";
import { Network } from "./Network.ts";
import type * as Snapshot from "#/Snapshot.ts";

export class Sandbox extends Context.Service<
  Sandbox,
  {
    snapshot: Snapshot.Snapshot;
    fs: FileSystem["Service"];
    process: Process["Service"];
    pty: Terminal["Service"];
    network: Network["Service"];
  }
>()("Sandbox") {}
export type SandboxService = Sandbox["Service"];

export const layerFrom = (snapshot: Snapshot.Snapshot) =>
  Layer.effect(
    Sandbox,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const process = yield* Process;
      const pty = yield* Terminal;
      const network = yield* Network;

      return { snapshot, fs, process, pty, network };
    }),
  );
