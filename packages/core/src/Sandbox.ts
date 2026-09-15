import { Context, Effect, Layer, Schema, type Scope, Sink, Stream } from "effect";
import type { QuitError, UserInput } from "effect/Terminal";
import type { Cause, Queue } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import type { TemplateExpression } from "effect/unstable/process/ChildProcess";
import type { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { makeScript } from "#/Shell.ts";
import validator from "validator";
import type * as Snapshot from "#/Snapshot.ts";

export class ConnectionError extends Schema.TaggedError<ConnectionError>()("ConnectionError", {
  cause: Schema.Defect(),
}) {}

export class OperationFailed extends Schema.TaggedError<OperationFailed>(
  "open-insight/sandbox/SandboxError/OperationFailed",
)("OperationFailed", {
  operation: Schema.String,
  cause: Schema.Defect(),
  message: Schema.optional(Schema.String),
}) {}

export const SandboxErrorReason = Schema.Union([ConnectionError, OperationFailed]);

export class SandboxError extends Schema.TaggedError<SandboxError>()("SandboxError", {
  reason: SandboxErrorReason,
}) {}

export const operationFailed = (operation: string, message?: string) => (cause: unknown) =>
  new SandboxError({
    reason: new OperationFailed({ cause, message, operation }),
  });

export const NonNegative = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class Resources extends Schema.Class<Resources>("Resources")({
  /**
   * Number of CPUs allocated to the sandbox.
   *
   * Can be a fractional number, e.g. 0.5 for half a CPU.
   *
   * Note: Fractional CPU allocation behaves varies across different sandbox providers.
   */
  numCPUs: Schema.OptionFromOptionalNullOr(NonNegative),

  /** Number of GPUs allocated to the sandbox. */
  numGPUs: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Memory allocated to the sandbox in MiB. */
  memoryMiB: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Storage allocated to the sandbox in MiB. */
  storageMiB: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Maximum time allowed to build a snapshot, in seconds. */
  buildTimeoutSec: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Maximum time allowed for the sandbox to run, in seconds. */
  runTimeoutSec: Schema.OptionFromOptionalNullOr(NonNegativeInt),
}) {}

export type ResourcesEncoded = Schema.Codec.Encoded<typeof Resources>;

export const makeResources = Schema.decodeSync(Resources);

export const providerDefault = makeResources({});

const fqdnOptions = {
  allow_trailing_dot: true,
  allow_wildcard: true,
  require_tld: false,
};

export const isAllowedHost = (value: string): boolean => {
  const host = value.trim();

  if (host.length === 0 || host.includes("[") || host.includes("]")) {
    return false;
  }

  return validator.isIP(host) || validator.isIPRange(host) || validator.isFQDN(host, fqdnOptions);
};

const isAllowedHostsForMode = ({
  mode,
  allowedHosts,
}: {
  readonly mode: string;
  readonly allowedHosts: ReadonlyArray<unknown>;
}): boolean => mode === "allowlist" || allowedHosts.length === 0;

export const NetworkPolicyMode = Schema.Union([
  Schema.Literal("public"),
  Schema.Literal("no-network"),
  Schema.Literal("allowlist"),
]);

export type NetworkPolicyMode = Schema.Schema.Type<typeof NetworkPolicyMode>;

export const AllowedHost = Schema.String.check(
  Schema.makeFilter(isAllowedHost, {
    expected:
      "an exact hostname, leading-wildcard hostname, IP address, or CIDR without a URL, port, or path",
  }),
);

export type AllowedHost = Schema.Schema.Type<typeof AllowedHost>;

const PolicyFields = Schema.Struct({
  mode: NetworkPolicyMode,
  allowedHosts: Schema.Array(AllowedHost),
}).check(
  Schema.makeFilter(isAllowedHostsForMode, {
    expected: "allowedHosts to be empty unless mode is allowlist",
  }),
);

export class NetworkPolicy extends Schema.Class<NetworkPolicy>("NetworkPolicy")(PolicyFields) {}

/** Metadata that can be represented by WebDAV properties. */
export interface ResourceInfo {
  /** `Directory` represents a WebDAV collection; other resources are `File`. */
  readonly type: "File" | "Directory";
  readonly size?: bigint;
  readonly etag?: string;
  readonly lastModified?: Date;
  readonly creationDate?: Date;
  readonly contentType?: string;
}

/**
 * Represent a remote file system in a sandbox.
 */
export class FileSystem extends Context.Service<
  FileSystem,
  {
    /**
     * Checks whether a path can be accessed.
     */
    readonly access: (path: string) => Effect.Effect<void, SandboxError>;

    /**
     * Checks whether a path exists.
     */
    readonly exists: (path: string) => Effect.Effect<boolean, SandboxError>;

    /**
     * Copy a file or directory from `fromPath` to `toPath`.
     */
    readonly copy: (
      fromPath: string,
      toPath: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Create a directory at `path`. You can optionally specify whether to recursively create nested directories.
     *
     * **Details**
     *
     * `MKCOL` never creates intermediate collections, so `recursive` sends one
     * request per path segment. Creating a directory that already exists is not
     * an error.
     */
    readonly makeDirectory: (
      path: string,
      options?: { readonly recursive?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * List the contents of a directory.
     *
     * **Details**
     *
     * Returns entry names relative to `path`. You can recursively list the
     * contents of nested directories by setting the `recursive` option, which
     * walks the tree with one request per directory because servers are only
     * required to support `Depth: 0` and `Depth: 1`.
     */
    readonly readDirectory: (
      path: string,
      options?: { readonly recursive?: boolean },
    ) => Effect.Effect<ReadonlyArray<string>, SandboxError>;

    /**
     * Read the contents of a file.
     */
    readonly readFile: (path: string) => Effect.Effect<Uint8Array, SandboxError>;

    /**
     * Read the contents of a file and decode it with `encoding`, which defaults
     * to `utf-8`.
     */
    readonly readFileString: (
      path: string,
      encoding?: string,
    ) => Effect.Effect<string, SandboxError>;

    /**
     * Remove a file or directory.
     */
    readonly remove: (path: string) => Effect.Effect<void, SandboxError>;

    /**
     * Rename a file or directory.
     */
    readonly rename: (
      oldPath: string,
      newPath: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Get information about a file at `path`.
     */
    readonly stat: (path: string) => Effect.Effect<ResourceInfo, SandboxError>;

    /**
     * Create a readable `Stream` for the specified `path`.
     */
    readonly stream: (
      path: string,
      options?: {
        readonly bytesToRead?: bigint;
        readonly offset?: bigint;
      },
    ) => Stream.Stream<Uint8Array, SandboxError>;

    /**
     * Create a writable `Sink` for the specified `path`.
     */
    readonly sink: (path: string) => Sink.Sink<void, Uint8Array, never, SandboxError>;

    /**
     * Read text lines from a file at `path`.
     */
    readonly readLines: (
      path: string,
      options: { startLine?: number; encoding?: string },
    ) => Stream.Stream<string, SandboxError>;

    /**
     * Write data to a file at `path`.
     *
     * **Details**
     *
     * Fails when `overwrite` is `false` and the file already exists.
     */
    readonly writeFile: (
      path: string,
      data: Uint8Array,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Write a string to a file at `path`, encoded as UTF-8.
     */
    readonly writeFileString: (
      path: string,
      data: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    readonly replaceLines: (
      path: string,
      options: { startLine?: number; encoding?: string },
    ) => Effect.Effect<void, SandboxError>;
  }
>()("@open-insight/agent/fs/FileSystem") {}

/**
 * A handle to a running child process.
 *
 * @category models
 * @since 4.0.0
 */
export interface ProcessResult {
  /**
   * Waits for the child process to exit and returns the `ExitCode` of the
   * command that was run.
   */
  readonly exitCode: ExitCode;

  /**
   * The standard output stream for the child process.
   *
   * **Gotchas**
   *
   * Using this stream alongside `all` may cause interleaving of output and
   * unexpected results.
   */
  readonly stdout: Uint8Array;
  /**
   * The standard error stream for the child process.
   *
   * **Gotchas**
   *
   * Using this stream alongside `all` may cause interleaving of output and
   * unexpected results.
   */
  readonly stderr: Uint8Array;
}

export interface CommandOptions {
  /**
   * The current working directory of the child process.
   */
  readonly cwd?: string | undefined;
  /**
   * The environment of the child process.
   *
   * **Details**
   *
   * If `extendEnv` is set to `true`, the value of `env` will be merged with
   * the value of `globalThis.process.env`, prioritizing the values in `env`
   * when conflicts exist.
   *
   * **Gotchas**
   *
   * Without `extendEnv: true`, providing `env` replaces the inherited child
   * environment. The child will not receive `PATH` unless `env` includes it.
   */
  readonly env?: Record<string, string | undefined> | undefined;
}

export interface ShellCommandOptions extends CommandOptions {
  readonly shell?: string;
}

const isTemplateStringsArray = (
  value: TemplateStringsArray | ShellCommandOptions,
): value is TemplateStringsArray => Array.isArray(value);

const makeShellCommand = (
  strings: TemplateStringsArray,
  values: ReadonlyArray<TemplateExpression>,
  options: ShellCommandOptions = {},
): Command => {
  const { shell = "/bin/sh", ...commandOptions } = options;

  return CP.make(shell, ["-c", makeScript(strings, values)], commandOptions);
};

export type Command = Readonly<{
  command: string;
  args: ReadonlyArray<string>;
  options?: CommandOptions;
}>;

export const makeCommand = (
  command: string,
  args: ReadonlyArray<string> = [],
  options?: CommandOptions,
): Command => ({ command, args, options });

export class Process extends Context.Service<
  Process,
  {
    /**
     * Spawn a command and return a handle for interaction.
     */
    spawn(command: Command): Effect.Effect<ProcessResult, SandboxError>;

    $: {
      (
        strings: TemplateStringsArray,
        ...values: ReadonlyArray<TemplateExpression>
      ): Effect.Effect<string, SandboxError>;
      (
        options: ShellCommandOptions,
      ): (
        strings: TemplateStringsArray,
        ...values: ReadonlyArray<TemplateExpression>
      ) => Effect.Effect<string, SandboxError>;
    };

    /**
     * Run a command and return its exit code.
     */
    exitCode(command: Command): Effect.Effect<ExitCode, SandboxError>;

    /**
     * Run a command and return the lines of its output as an array of strings.
     */
    lines(
      command: Command,
      options?: {
        readonly includeStderr?: boolean | undefined;
      },
    ): Effect.Effect<Array<string>, SandboxError>;

    /**
     * Run a command and return its output as a string.
     */
    string(
      command: Command,
      options?: {
        readonly includeStderr?: boolean | undefined;
      },
    ): Effect.Effect<string, SandboxError>;
  }
>()("effect/process/ChildProcessSpawner") {}

type PlatformSpawn = (
  command: Command,
) => Effect.Effect<ProcessResult, import("effect").PlatformError.PlatformError>;

const formatCommand = ({ command, args }: Command): string => [command, ...args].join(" ");

export const makeProcess = (spawn: PlatformSpawn): Process["Service"] => {
  const spawnSandbox = (command: Command) =>
    spawn(command).pipe(Effect.mapError(operationFailed("spawn", formatCommand(command))));

  const string: Process["Service"]["string"] = (command) =>
    spawnSandbox(command).pipe(Effect.map(({ stdout }) => new TextDecoder().decode(stdout)));

  function $(
    strings: TemplateStringsArray,
    ...values: ReadonlyArray<TemplateExpression>
  ): Effect.Effect<string, SandboxError>;
  function $(
    options: ShellCommandOptions,
  ): (
    strings: TemplateStringsArray,
    ...values: ReadonlyArray<TemplateExpression>
  ) => Effect.Effect<string, SandboxError>;
  function $(
    first: TemplateStringsArray | ShellCommandOptions,
    ...values: ReadonlyArray<TemplateExpression>
  ) {
    if (isTemplateStringsArray(first)) {
      return string(makeShellCommand(first, values));
    }

    return (strings: TemplateStringsArray, ...innerValues: ReadonlyArray<TemplateExpression>) =>
      string(makeShellCommand(strings, innerValues, first));
  }

  return Process.of({
    spawn: spawnSandbox,
    $,
    string,
    lines: (command) => string(command).pipe(Effect.map((stdout) => stdout.split("\n"))),
    exitCode: (command) => Effect.map(spawnSandbox(command), ({ exitCode }) => exitCode),
  });
};

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
      instructions: Snapshot.Instructions;
      context: string;
      cache?: boolean;
    }>,
  ): Effect.Effect<Snapshot.Snapshot, ProviderError, Scope.Scope>;

  /**
   * Run a sandbox with the given snapshot.
   */
  runSandbox(options: {
    snapshot: Snapshot.Snapshot;
    resources: Resources;
    cache?: boolean;
  }): Effect.Effect<Sandbox["Service"], ProviderError, Scope.Scope>;
}>;

export class SandboxProvider extends Context.Service<SandboxProvider, Provider>()(
  "sandbox/ProviderService",
) {}

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
