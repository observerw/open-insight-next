import { Context, Effect, Layer, type Scope, Stream } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import type { Command } from "effect/unstable/process/ChildProcess";
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
} from "effect/unstable/process/ChildProcessSpawner";
import { makeScript, type TemplateExpression } from "@/utils/Shell.ts";
import { Data, Formatter } from "effect";
import type { PlatformError } from "effect";

export class NonZeroExit extends Data.TaggedError("NonZeroExit")<{
  readonly exitCode: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}> {
  override get message(): string {
    return `process exited with code ${this.exitCode}`;
  }
}

export class Platform extends Data.TaggedError("Platform")<{
  readonly cause: PlatformError.PlatformError;
}> {
  override get message(): string {
    return `platform error: ${Formatter.format(this.cause)}`;
  }
}

export type ErrorReason = NonZeroExit | Platform;

export class SpawnError extends Data.TaggedError("SpawnError")<{
  readonly reason: ErrorReason;
}> {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static platform = (cause: PlatformError.PlatformError): SpawnError =>
    new SpawnError({ reason: new Platform({ cause }) });

  static exit = (
    exitCode: ExitCode,
    stdout: string,
    stderr: string,
  ): SpawnError =>
    new SpawnError({ reason: new NonZeroExit({ exitCode, stdout, stderr }) });
}

type ShellOptions = Readonly<{
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
}>;

const isTemplateStringsArray = (
  value: TemplateStringsArray | ShellOptions,
): value is TemplateStringsArray => Array.isArray(value);

const makeShellCommand = (
  strings: TemplateStringsArray,
  values: ReadonlyArray<TemplateExpression>,
  options: ShellOptions = {},
): Command => {
  return CP.make("sh", ["-c", makeScript(strings, values)], options);
};

export type ExecHandle = Readonly<{
  exitCode: ExitCode;
  stdout: string;
  stderr: string;
}>;

const toExecHandle = Effect.fn(function* (handle: ChildProcessHandle) {
  const exitCode = yield* handle.exitCode.pipe(
    Effect.mapError(SpawnError.platform),
  );

  const { stdout, stderr } = yield* Effect.all(
    {
      stdout: Stream.mkString(Stream.decodeText(handle.stdout)),
      stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
    },
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError(SpawnError.platform));

  return {
    exitCode,
    stdout,
    stderr,
  } satisfies ExecHandle;
});

export type Options = Readonly<{
  /**
   * Whether to throw an error if the spawned process exits with a non-zero exit code.
   * Default is true.
   */
  readonly errorOnNonZeroExit?: boolean;
}>;

/**
 * `ChildProcessSpawner` with additional options to throw an error if the spawned process exits with a non-zero exit code.
 */
export class Service extends Context.Service<
  Service,
  {
    spawn(
      command: Command,
      options?: Options,
    ): Effect.Effect<ChildProcessHandle, SpawnError, Scope.Scope>;

    exec(
      command: Command,
      options?: Options,
    ): Effect.Effect<ExecHandle, SpawnError>;

    exitCode(command: Command): Effect.Effect<ExitCode, SpawnError>;

    success(command: Command): Effect.Effect<void, SpawnError>;

    streamString(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined } & Options,
    ): Stream.Stream<string, SpawnError>;

    streamLines(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined } & Options,
    ): Stream.Stream<string, SpawnError>;

    string(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined } & Options,
    ): Effect.Effect<string, SpawnError>;

    lines(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined } & Options,
    ): Effect.Effect<ReadonlyArray<string>, SpawnError>;

    $: {
      (
        strings: TemplateStringsArray,
        ...values: ReadonlyArray<TemplateExpression>
      ): Effect.Effect<string, SpawnError>;

      (
        options: ShellOptions,
      ): (
        strings: TemplateStringsArray,
        ...values: ReadonlyArray<TemplateExpression>
      ) => Effect.Effect<string, SpawnError>;
    };
  }
>()("packages/core/spawn/SpawnService") {
  static readonly layer: Layer.Layer<Service, never, ChildProcessSpawner> =
    Layer.effect(
      Service,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner;

        const spawn: Service["Service"]["spawn"] = Effect.fn(function* (
          command: Command,
          { errorOnNonZeroExit = true }: Options = {},
        ) {
          const handle = yield* spawner.spawn(command).pipe(
            Effect.mapError(SpawnError.platform),
          );
          const exitCode = yield* handle.exitCode.pipe(
            Effect.mapError(SpawnError.platform),
          );

          if (exitCode !== 0 && errorOnNonZeroExit) {
            const { stdout, stderr } = yield* toExecHandle(handle);
            return yield* Effect.fail(
              SpawnError.exit(exitCode, stdout, stderr),
            );
          }

          return handle;
        });

        const exec: Service["Service"]["exec"] = Effect.fn(
          function* (command: Command, options?: Options) {
            const handle = yield* spawn(command, options);
            return yield* toExecHandle(handle);
          },
          (effect) => effect.pipe(Effect.scoped),
        );

        const exitCode: Service["Service"]["exitCode"] = (command) =>
          spawn(command)
            .pipe(
              Effect.catchTag(
                "SpawnError",
                (err) =>
                  err.reason._tag === "NonZeroExit"
                    ? Effect.succeed(err.reason.exitCode)
                    : Effect.fail(err),
              ),
              Effect.map(() => ExitCode(0)),
            )
            .pipe(Effect.scoped);

        const success: Service["Service"]["success"] = (command) =>
          spawn(command).pipe(Effect.scoped, Effect.asVoid);

        const string: Service["Service"]["string"] = (command, options = {}) =>
          Stream.mkString(streamString(command, options));

        const lines: Service["Service"]["lines"] = (command, options = {}) =>
          Stream.runCollect(streamLines(command, options));

        function $(
          strings: TemplateStringsArray,
          ...values: ReadonlyArray<TemplateExpression>
        ): Effect.Effect<string, SpawnError>;
        function $(
          options: ShellOptions,
        ): (
          strings: TemplateStringsArray,
          ...values: ReadonlyArray<TemplateExpression>
        ) => Effect.Effect<string, SpawnError>;
        function $(
          first: TemplateStringsArray | ShellOptions,
          ...values: ReadonlyArray<TemplateExpression>
        ) {
          if (isTemplateStringsArray(first)) {
            return string(makeShellCommand(first, values));
          }
          return (
            strings: TemplateStringsArray,
            ...innerValues: ReadonlyArray<TemplateExpression>
          ) => string(makeShellCommand(strings, innerValues, first));
        }

        const streamString: Service["Service"]["streamString"] = (
          command,
          { includeStderr, ...options } = {},
        ) =>
          spawn(command, options).pipe(
            Effect.map((handle) =>
              Stream.decodeText(
                includeStderr === true ? handle.all : handle.stdout,
              ).pipe(
                Stream.mapError(SpawnError.platform),
              )
            ),
            Stream.unwrap,
          );

        const streamLines: Service["Service"]["streamLines"] = (
          command,
          options,
        ) => Stream.splitLines(streamString(command, options));

        return {
          spawn,
          exitCode,
          exec,
          success,
          streamString,
          streamLines,
          lines,
          string,
          $,
        } satisfies Service["Service"];
      }),
    );
}
