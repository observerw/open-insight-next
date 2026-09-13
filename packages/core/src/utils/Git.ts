import { Context, Data, Effect, Layer, Option } from "effect";
import { ChildProcess } from "effect/unstable/process";
import type { ChildProcessSpawner } from "effect/unstable/process";
import * as Process from "./Process.ts";

export class GitError extends Data.TaggedError("GitError")<{
  readonly cause: Process.ProcessError;
}> {
  override get message(): string {
    return `git command failed: ${this.cause.message}`;
  }
}

const command = (args: ReadonlyArray<string>) => ChildProcess.make("git", args);

type GitProcess = Pick<Process.Process["Service"], "string" | "lines" | "exec">;

export const make = (process: GitProcess): Git["Service"] => {
  const run = Effect.fn(function* (args: ReadonlyArray<string>) {
    return yield* process
      .string(command(args))
      .pipe(Effect.mapError((cause) => new GitError({ cause })));
  });
  const output = Effect.fn(function* (args: ReadonlyArray<string>) {
    return (yield* run(args)).trim();
  });
  const lines = Effect.fn(function* (args: ReadonlyArray<string>) {
    return yield* process
      .lines(command(args))
      .pipe(Effect.mapError((cause) => new GitError({ cause })));
  });
  const tagCommitHash = Effect.fn(function* (tag: string) {
    return yield* output(["rev-list", "-n", "1", tag]);
  });
  const tagMessage = Effect.fn(function* (tag: string) {
    return yield* output(["for-each-ref", "--format=%(contents:subject)", `refs/tags/${tag}`]);
  });
  const nearestTag = Effect.fn(function* () {
    const result = yield* process
      .exec(command(["describe", "--tags", "--abbrev=0", "HEAD"]), {
        errorOnNonZeroExit: false,
      })
      .pipe(Effect.mapError((cause) => new GitError({ cause })));

    return result.exitCode === 0 && result.stdout.trim() !== ""
      ? Option.some(result.stdout.trim())
      : Option.none();
  });

  return {
    commitHash: output(["rev-parse", "HEAD"]),
    remoteOrigin: output(["config", "--get", "remote.origin.url"]),
    isDirty: output(["status", "--porcelain"]).pipe(Effect.map((value) => value !== "")),
    currentBranch: output(["branch", "--show-current"]),
    commitMessage: output(["log", "-1", "--pretty=%B"]),
    nearestTag: nearestTag(),
    tagsAtCommit: lines(["tag", "--points-at", "HEAD"]),
    tags: lines(["tag", "--list"]),
    tagCommitHash,
    tagMessage,
  };
};

export class Git extends Context.Service<
  Git,
  {
    readonly commitHash: Effect.Effect<string, GitError>;
    readonly remoteOrigin: Effect.Effect<string, GitError>;
    readonly isDirty: Effect.Effect<boolean, GitError>;
    readonly currentBranch: Effect.Effect<string, GitError>;
    readonly commitMessage: Effect.Effect<string, GitError>;
    readonly nearestTag: Effect.Effect<Option.Option<string>, GitError>;
    readonly tagsAtCommit: Effect.Effect<ReadonlyArray<string>, GitError>;
    readonly tags: Effect.Effect<ReadonlyArray<string>, GitError>;
    readonly tagCommitHash: (tag: string) => Effect.Effect<string, GitError>;
    readonly tagMessage: (tag: string) => Effect.Effect<string, GitError>;
  }
>()("packages/core/git/GitService") {
  static readonly layer: Layer.Layer<Git, GitError, ChildProcessSpawner.ChildProcessSpawner> =
    Layer.effect(
      Git,
      Effect.gen(function* () {
        const process = yield* Process.Process;
        return make(process);
      }).pipe(Effect.provide(Process.Process.layer)),
    );
}
