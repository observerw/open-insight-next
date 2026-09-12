import { Schema } from "effect";

export const CopyOptions = Schema.Struct({
  /** Build stage, named context, or image to copy from. */
  from: Schema.optionalKey(Schema.String),
  /** File mode to apply to copied files and directories. */
  chmod: Schema.optionalKey(Schema.String),
  /** User and group ownership to apply to copied files and directories. */
  chown: Schema.optionalKey(Schema.String),
  /** Create the copy as an independent layer. */
  link: Schema.optionalKey(Schema.Boolean),
  /** Preserve source parent directories. */
  parents: Schema.optionalKey(Schema.Boolean),
  /** Patterns to exclude from the copy. */
  exclude: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type CopyOptions = Schema.Schema.Type<typeof CopyOptions>;

export const RunOptions = Schema.Struct({
  /** Network available to the build step. */
  network: Schema.optionalKey(Schema.Literals(["default", "none", "host"])),
});
export type RunOptions = Schema.Schema.Type<typeof RunOptions>;

export const Instruction = Schema.TaggedUnion({
  Workdir: {
    path: Schema.String,
  },
  User: {
    /**
     * Accepts either `"user"` or `"user:group"`.
     */
    user: Schema.String,
  },
  Run: {
    cmd: Schema.String,
    ...RunOptions.fields,
  },
  Cmd: {
    cmd: Schema.NonEmptyArray(Schema.String),
  },
  Env: {
    env: Schema.Record(Schema.String, Schema.String),
  },
  Copy: {
    src: Schema.Array(Schema.String),
    dest: Schema.String,
    ...CopyOptions.fields,
  },
});
export type Instruction = Schema.Schema.Type<typeof Instruction>;

export const workdir = (workdir: string): Instruction =>
  Instruction.make({ _tag: "Workdir", path: workdir });

export const user = (user: string): Instruction => Instruction.make({ _tag: "User", user });

export const run = (cmd: string, options: RunOptions = {}): Instruction =>
  Instruction.make({ _tag: "Run", cmd, ...options });

export const cmd = (program: string, ...args: ReadonlyArray<string>): Instruction =>
  Instruction.make({ _tag: "Cmd", cmd: [program, ...args] });

export const assert = (...cmd: string[]): Instruction =>
  Instruction.make({ _tag: "Run", cmd: cmd.join(" && ") + " || exit 1" });

export const available = (...program: string[]): Instruction =>
  assert(...program.map((p) => `command -v ${p}`));

export const env = (env: Record<string, string>): Instruction =>
  Instruction.make({ _tag: "Env", env });

export const copy = (src: string[], dest: string, options: CopyOptions = {}): Instruction =>
  Instruction.make({ _tag: "Copy", src, dest, ...options });

export const Instructions = Schema.Array(Instruction);
export type Instructions = Schema.Schema.Type<typeof Instructions>;
