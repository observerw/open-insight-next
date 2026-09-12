import { Context, Data, Effect, Formatter, Layer, Stream } from "effect";
import type { Scope } from "effect/Scope";
import type { PlatformError } from "effect/PlatformError";
import type { Command } from "effect/unstable/process/ChildProcess";
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
} from "effect/unstable/process/ChildProcessSpawner";

/**
 * The process exited with a non-zero exit code.
 */
export class NonZeroExit extends Data.TaggedError("NonZeroExit")<{
  readonly exitCode: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}> {
  override get message(): string {
    return `process exited with code ${this.exitCode}`;
  }
}

/**
 * The process could not be operated by the host platform.
 */
export class Platform extends Data.TaggedError("Platform")<{
  readonly cause: PlatformError;
}> {
  override get message(): string {
    return `platform error: ${Formatter.format(this.cause)}`;
  }
}

export type ProcessErrorReason = NonZeroExit | Platform;

/**
 * The error channel for process operations.
 */
export class ProcessError extends Data.TaggedError("ProcessError")<{
  readonly reason: ProcessErrorReason;
}> {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ProcessErrorReason {
    return this.reason;
  }

  static readonly platform = (cause: PlatformError): ProcessError =>
    new ProcessError({ reason: new Platform({ cause }) });

  static readonly exit = (exitCode: ExitCode, stdout: string, stderr: string): ProcessError =>
    new ProcessError({ reason: new NonZeroExit({ exitCode, stdout, stderr }) });
}

export type ExecHandle = Readonly<{
  readonly exitCode: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}>;

const toExecHandle = Effect.fn(function* (handle: ChildProcessHandle) {
  const exitCode = yield* handle.exitCode.pipe(Effect.mapError(ProcessError.platform));

  const { stdout, stderr } = yield* Effect.all(
    {
      stdout: Stream.mkString(Stream.decodeText(handle.stdout)),
      stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
    },
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError(ProcessError.platform));

  return { exitCode, stdout, stderr } satisfies ExecHandle;
});

export type Options = Readonly<{
  /** Whether to fail when the process exits with a non-zero exit code. */
  readonly errorOnNonZeroExit?: boolean;
}>;

type OutputOptions = Readonly<{
  readonly includeStderr?: boolean;
}> &
  Options;

/**
 * `ChildProcessSpawner` with checked-exits.
 */
export class Process extends Context.Service<
  Process,
  {
    process(
      command: Command,
      options?: Options,
    ): Effect.Effect<ChildProcessHandle, ProcessError, Scope>;

    exec(command: Command, options?: Options): Effect.Effect<ExecHandle, ProcessError>;

    exitCode(command: Command): Effect.Effect<ExitCode, ProcessError>;

    success(command: Command): Effect.Effect<void, ProcessError>;

    streamString(command: Command, options?: OutputOptions): Stream.Stream<string, ProcessError>;

    streamLines(command: Command, options?: OutputOptions): Stream.Stream<string, ProcessError>;

    string(command: Command, options?: OutputOptions): Effect.Effect<string, ProcessError>;

    lines(
      command: Command,
      options?: OutputOptions,
    ): Effect.Effect<ReadonlyArray<string>, ProcessError>;
  }
>()("packages/core/utils/Process") {
  static readonly layer: Layer.Layer<Process, never, ChildProcessSpawner> = Layer.effect(
    Process,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner;

      const process: Process["Service"]["process"] = Effect.fn(function* (
        command,
        { errorOnNonZeroExit = true }: Options = {},
      ) {
        const handle = yield* spawner.spawn(command).pipe(Effect.mapError(ProcessError.platform));
        const exitCode = yield* handle.exitCode.pipe(Effect.mapError(ProcessError.platform));

        if (exitCode !== 0 && errorOnNonZeroExit) {
          const { stdout, stderr } = yield* toExecHandle(handle);
          return yield* ProcessError.exit(exitCode, stdout, stderr);
        }

        return handle;
      });

      const exec: Process["Service"]["exec"] = Effect.fn(
        function* (command, options) {
          const handle = yield* process(command, options);
          return yield* toExecHandle(handle);
        },
        (effect) => effect.pipe(Effect.scoped),
      );

      const exitCode: Process["Service"]["exitCode"] = (command) =>
        process(command).pipe(
          Effect.catchTag("ProcessError", (error) =>
            error.reason._tag === "NonZeroExit"
              ? Effect.succeed(error.reason.exitCode)
              : Effect.fail(error),
          ),
          Effect.map(() => ExitCode(0)),
          Effect.scoped,
        );

      const success: Process["Service"]["success"] = (command) =>
        process(command).pipe(Effect.scoped, Effect.asVoid);

      const streamString: Process["Service"]["streamString"] = (
        command,
        { includeStderr, ...options } = {},
      ) =>
        process(command, options).pipe(
          Effect.map((handle) =>
            Stream.decodeText(includeStderr === true ? handle.all : handle.stdout).pipe(
              Stream.mapError(ProcessError.platform),
            ),
          ),
          Stream.unwrap,
        );

      const streamLines: Process["Service"]["streamLines"] = (command, options) =>
        Stream.splitLines(streamString(command, options));

      const string: Process["Service"]["string"] = (command, options = {}) =>
        Stream.mkString(streamString(command, options));

      const lines: Process["Service"]["lines"] = (command, options = {}) =>
        Stream.runCollect(streamLines(command, options));

      return {
        process,
        exec,
        exitCode,
        success,
        streamString,
        streamLines,
        string,
        lines,
      } satisfies Process["Service"];
    }),
  );
}
