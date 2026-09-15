import { Context, Effect, type PlatformError } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import type { TemplateExpression } from "effect/unstable/process/ChildProcess";
import type { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { operationFailed } from "./SandboxError.ts";
import type { SandboxError } from "./SandboxError.ts";
import { makeScript } from "#/Shell.ts";

/**
 * A handle to a running child process.
 *
 * @category models
 * @since 4.0.0
 */
export interface Result {
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
    spawn(command: Command): Effect.Effect<Result, SandboxError>;

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

type PlatformSpawn = (command: Command) => Effect.Effect<Result, PlatformError.PlatformError>;

const formatCommand = ({ command, args }: Command): string => [command, ...args].join(" ");

export const make = (spawn: PlatformSpawn): Process["Service"] => {
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
