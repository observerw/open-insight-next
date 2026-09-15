import type * as Snapshot from "#/Snapshot.ts";
import type * as Sandbox from "./Sandbox.ts";
import { Context, type Effect, type Layer, Schema, type Scope } from "effect";
import type * as Resources from "./Resources.ts";

/** The provider cannot build an image from the requested Containerfile. */
export class BuildUnsupported extends Schema.TaggedError<BuildUnsupported>(
  "open-insight/sandbox/SandboxProvider/BuildUnsupported",
)("BuildUnsupported", {}) {}

/**
 * Recoverable failures exposed by a sandbox provider.
 *
 * Add a new tagged error here only when the provider contract can classify it
 * and callers have a distinct recovery or reporting action.
 */
export type ProviderError = BuildUnsupported;

export type Provider = Readonly<{
  /**
   * Acquire a snapshot from a template, which can be used to run a sandbox or derive a new snapshot.
   *
   * The snapshot refers to a template that is guaranteed to exist in the provider's storage during the scope.
   *
   * Providers that cannot build an image from a local Dockerfile or Containerfile must fail a
   * `Containerfile` template with `BuildUnsupported`.
   *
   * @argument cache - If false, the provider will not cache the snapshot and will remove it from storage when the scope ends.
   */
  acquireSnapshot(
    options: Readonly<{
      template: Snapshot.Template;
      cache?: boolean;
    }>,
  ): Effect.Effect<Snapshot.Snapshot, ProviderError, Scope.Scope>;

  /**
   * Derive a new snapshot from an existing snapshot with a set of instructions.
   *
   * The derived one is directly built from the given snapshot.
   */
  deriveSnapshot(
    options: Readonly<{
      snapshot: Snapshot.Snapshot;
      instructions: Snapshot.Instruction.Instructions;
      context: string;
      cache?: boolean;
    }>,
  ): Effect.Effect<Snapshot.Snapshot, ProviderError, Scope.Scope>;

  /**
   * Run a sandbox with the given snapshot.
   */
  runSandbox(options: {
    snapshot: Snapshot.Snapshot;
    resources: Resources.Resources;
    cache?: boolean;
  }): Effect.Effect<Sandbox.Sandbox["Service"], ProviderError, Scope.Scope>;
}>;

export class SandboxProvider extends Context.Service<SandboxProvider, Provider>()(
  "sandbox/ProviderService",
) {}
