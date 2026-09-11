import * as Snapshot from "@/Snapshot.ts";

export type RunSandboxOptions = Readonly<{
  snapshot: Snapshot.Snapshot;
  resources: Resources;
  cache: boolean;
}>;

export type Provider = Readonly<{
  /**
   * Acquire a snapshot from a template, which can be used to run a sandbox or derive a new snapshot.
   *
   * The snapshot refers to a template that is guaranteed to exist in the provider's storage during the scope.
   *
   * Providers that cannot build an image from a local Dockerfile or Containerfile must fail a
   * `Containerfile` template with `SandboxError.buildUnsupported`.
   *
   * @argument cache - If false, the provider will not cache the snapshot and will remove it from storage when the scope ends.
   */
  acquireSnapshot(
    options: Readonly<{
      template: Snapshot.Template;
      cache: boolean;
    }>,
  ): Effect.Effect<Snapshot.Snapshot, SandboxError, Scope.Scope>;

  /**
   * Derive a new snapshot from an existing snapshot with a set of instructions.
   *
   * The derived one is directly built from the given snapshot.
   */
  deriveSnapshot(
    options: Readonly<{
      snapshot: Snapshot.Snapshot;
      instructions: Snapshot.Instructions;
      context: string;
      cache: boolean;
    }>,
  ): Effect.Effect<Snapshot.Snapshot, SandboxError, Scope.Scope>;

  /**
   * Run a sandbox with the given snapshot.
   */
  runSandbox(
    options: RunSandboxOptions,
  ): Effect.Effect<Sandbox["Service"], SandboxError, Scope.Scope>;

  /**
   * Create a layer that provides a sandbox.
   */
  sandboxLayer(
    options: RunSandboxOptions,
  ): Layer.Layer<Sandbox, SandboxError, Scope.Scope>;
}>;

export class ProviderService
  extends Context.Service<ProviderService, Provider>()(
    "sandbox/ProviderService",
  ) {}
