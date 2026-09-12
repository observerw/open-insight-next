import { Context, Effect, Layer } from "effect";
import { FileSystem } from "./FileSystem.ts";
import { Process } from "./Process.ts";
import { Terminal } from "./Terminal.ts";
import { Network } from "./Network.ts";
import type * as Snapshot from "#/snapshot/index.ts";

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
