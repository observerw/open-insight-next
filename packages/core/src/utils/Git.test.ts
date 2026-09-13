import { assert, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import * as Git from "./Git.ts";
import * as Process from "./Process.ts";

const exit = new Process.NonZeroExit({ exitCode: ExitCode(1), stdout: "", stderr: "failed" });
const ProcessError = new Process.ProcessError({ reason: exit });

type Command = ChildProcess.StandardCommand;

const argsOf = (command: ChildProcess.Command): ReadonlyArray<string> =>
  ChildProcess.isStandardCommand(command) ? command.args : [];

const makeProcess = (responses: ReadonlyMap<string, string>) => {
  const calls: Array<ReadonlyArray<string>> = [];
  const exec: Pick<Process.Process["Service"], "exec">["exec"] = (command) => {
    const args = argsOf(command);
    calls.push(args);
    const value = responses.get(args.join(" "));
    return value === undefined
      ? Effect.succeed({ exitCode: ExitCode(1), stdout: "", stderr: "" })
      : Effect.succeed({ exitCode: ExitCode(0), stdout: value, stderr: "" });
  };
  const process = {
    exec,
    string: (command: Command) => {
      const args = argsOf(command);
      calls.push(args);
      const value = responses.get(args.join(" "));
      return value === undefined ? Effect.fail(ProcessError) : Effect.succeed(value);
    },
    lines: (command: Command) => {
      const args = argsOf(command);
      calls.push(args);
      const value = responses.get(args.join(" "));
      return value === undefined ? Effect.fail(ProcessError) : Effect.succeed(value.split("\n"));
    },
  } satisfies Pick<Process.Process["Service"], "string" | "lines" | "exec">;

  return { calls, process };
};

it.effect("queries repository and tag metadata", () =>
  Effect.gen(function* () {
    const fake = makeProcess(
      new Map([
        ["rev-parse HEAD", "abc123\n"],
        ["config --get remote.origin.url", "https://example.test/repo.git\n"],
        ["status --porcelain", " M src/index.ts\n"],
        ["branch --show-current", "main\n"],
        ["log -1 --pretty=%B", "release commit\n\n"],
        ["tag --points-at HEAD", "v1.0.0\nv1.0.0-rc.1"],
        ["tag --list", "v0.9.0\nv1.0.0\nv1.0.0-rc.1"],
        ["rev-list -n 1 v1.0.0", "abc123\n"],
        ["for-each-ref --format=%(contents:subject) refs/tags/v1.0.0", "Release 1.0.0\n"],
      ]),
    );
    const git = Git.make(fake.process);

    assert.strictEqual(yield* git.commitHash.pipe(Effect.orDie), "abc123");
    assert.strictEqual(yield* git.remoteOrigin.pipe(Effect.orDie), "https://example.test/repo.git");
    assert.isTrue(yield* git.isDirty.pipe(Effect.orDie));
    assert.strictEqual(yield* git.currentBranch.pipe(Effect.orDie), "main");
    assert.strictEqual(yield* git.commitMessage.pipe(Effect.orDie), "release commit");
    assert.deepStrictEqual(yield* git.tagsAtCommit.pipe(Effect.orDie), ["v1.0.0", "v1.0.0-rc.1"]);
    assert.deepStrictEqual(yield* git.tags.pipe(Effect.orDie), ["v0.9.0", "v1.0.0", "v1.0.0-rc.1"]);
    assert.strictEqual(yield* git.tagCommitHash("v1.0.0").pipe(Effect.orDie), "abc123");
    assert.strictEqual(yield* git.tagMessage("v1.0.0").pipe(Effect.orDie), "Release 1.0.0");

    assert.deepStrictEqual(fake.calls, [
      ["rev-parse", "HEAD"],
      ["config", "--get", "remote.origin.url"],
      ["status", "--porcelain"],
      ["branch", "--show-current"],
      ["log", "-1", "--pretty=%B"],
      ["tag", "--points-at", "HEAD"],
      ["tag", "--list"],
      ["rev-list", "-n", "1", "v1.0.0"],
      ["for-each-ref", "--format=%(contents:subject)", "refs/tags/v1.0.0"],
    ]);
  }),
);

it.effect("returns None when HEAD has no reachable tag", () =>
  Effect.gen(function* () {
    const fake = makeProcess(new Map());
    const git = Git.make(fake.process);
    const result = yield* git.nearestTag.pipe(Effect.orDie);

    assert.deepStrictEqual(result, Option.none());
    assert.deepStrictEqual(fake.calls, [["describe", "--tags", "--abbrev=0", "HEAD"]]);
  }),
);

it("constructs a tagged GitError with its process cause", () => {
  const error = new Git.GitError({ cause: ProcessError });

  assert.strictEqual(error._tag, "GitError");
  assert.strictEqual(error.cause, ProcessError);
});
