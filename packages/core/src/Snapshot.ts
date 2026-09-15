import { Data, Effect, FileSystem, Path, Schema } from "effect";

export const CopyOptions = Schema.Struct({
  from: Schema.optionalKey(Schema.String),
  chmod: Schema.optionalKey(Schema.String),
  chown: Schema.optionalKey(Schema.String),
  link: Schema.optionalKey(Schema.Boolean),
  parents: Schema.optionalKey(Schema.Boolean),
  exclude: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type CopyOptions = Schema.Schema.Type<typeof CopyOptions>;

export const RunOptions = Schema.Struct({
  network: Schema.optionalKey(Schema.Literals(["default", "none", "host"])),
});
export type RunOptions = Schema.Schema.Type<typeof RunOptions>;

export const Instruction = Schema.TaggedUnion({
  Workdir: { path: Schema.String },
  User: { user: Schema.String },
  Run: { cmd: Schema.String, ...RunOptions.fields },
  Cmd: { cmd: Schema.NonEmptyArray(Schema.String) },
  Env: { env: Schema.Record(Schema.String, Schema.String) },
  Copy: { src: Schema.Array(Schema.String), dest: Schema.String, ...CopyOptions.fields },
});
export type Instruction = Schema.Schema.Type<typeof Instruction>;
export const workdir = (path: string): Instruction => Instruction.make({ _tag: "Workdir", path });
export const user = (user: string): Instruction => Instruction.make({ _tag: "User", user });
export const run = (cmd: string, options: RunOptions = {}): Instruction =>
  Instruction.make({ _tag: "Run", cmd, ...options });
export const cmd = (program: string, ...args: ReadonlyArray<string>): Instruction =>
  Instruction.make({ _tag: "Cmd", cmd: [program, ...args] });
export const assert = (...commands: string[]): Instruction =>
  Instruction.make({ _tag: "Run", cmd: commands.join(" && ") + " || exit 1" });
export const available = (...programs: string[]): Instruction =>
  assert(...programs.map((program) => `command -v ${program}`));
export const env = (env: Record<string, string>): Instruction =>
  Instruction.make({ _tag: "Env", env });
export const copy = (src: string[], dest: string, options: CopyOptions = {}): Instruction =>
  Instruction.make({ _tag: "Copy", src, dest, ...options });
export const Instructions = Schema.Array(Instruction);
export type Instructions = Schema.Schema.Type<typeof Instructions>;

/** A template described with the provider-independent instruction set. */
export class InstructionsTemplate extends Schema.TaggedClass<InstructionsTemplate>()(
  "Instructions",
  {
    image: Schema.String,
    instructions: Instructions,
    /** Absolute build-context directory on the host machine. */
    context: Schema.String,
  },
) {}

/** A template described by a Dockerfile or Containerfile on the user's machine. */
export class ContainerfileTemplate extends Schema.TaggedClass<ContainerfileTemplate>()(
  "Containerfile",
  {
    /** Absolute path to the Dockerfile or Containerfile on the host machine. */
    filePath: Schema.String,
    /** Absolute build-context directory on the host machine. */
    context: Schema.String,
  },
) {}

export const Template = Schema.Union([InstructionsTemplate, ContainerfileTemplate]);
export type Template = Schema.Schema.Type<typeof Template>;

const defaultCommand = cmd("sleep", "infinity");

export const fromImage = (image: string): InstructionsTemplate =>
  new InstructionsTemplate({ image, context: "/tmp", instructions: [defaultCommand] });

export const Scratch = fromImage("scratch");
export const Alpine = fromImage("alpine:latest");
export const Debian = fromImage("debian:latest");

const encodeInstruction = (instruction: Instruction): string =>
  Instruction.match(instruction, {
    Workdir: ({ path }) => `WORKDIR ${path}`,
    User: ({ user }) => `USER ${user}`,
    Run: ({ cmd, network }) => `RUN${network === undefined ? "" : ` --network=${network}`} ${cmd}`,
    Cmd: ({ cmd }) => `CMD ${JSON.stringify(cmd)}`,
    Env: ({ env }) => {
      const keys = Object.keys(env).sort();

      return `ENV ${keys.map((key) => `${key}=${JSON.stringify(env[key])}`).join(" ")}`;
    },
    Copy: ({ src, dest, from, chmod, chown, link, parents, exclude }) => {
      const options = [
        from === undefined ? undefined : `--from=${from}`,
        chmod === undefined ? undefined : `--chmod=${chmod}`,
        chown === undefined ? undefined : `--chown=${chown}`,
        link === undefined ? undefined : `--link${link ? "" : "=false"}`,
        parents === undefined ? undefined : `--parents${parents ? "" : "=false"}`,
        ...(exclude ?? []).map((pattern) => `--exclude=${pattern}`),
      ].filter((option): option is string => option !== undefined);

      const prefix = options.length === 0 ? "" : `${options.join(" ")} `;

      return `COPY ${prefix}${JSON.stringify([...src, dest])}`;
    },
  });

/** Encode provider-independent instructions as a Containerfile. */
export const encode = ({
  image,
  instructions,
}: Readonly<{ image: string; instructions: Instructions }>): string => {
  const lines = [`FROM ${image}`, ...instructions.map(encodeInstruction)];

  return `${lines.join("\n")}\n`;
};

/** Write provider-independent instructions to a temporary Containerfile and return its path. */
export const writeInstructions = Effect.fn(function* (template: InstructionsTemplate) {
  const fs = yield* FileSystem.FileSystem;

  const containerfilePath = yield* fs.makeTempFile({
    prefix: "open-insight-",
    suffix: ".Containerfile",
  });

  yield* fs.writeFileString(containerfilePath, encode(template));
  return containerfilePath;
});

export const build = Effect.fn(function* ({
  filePath,
  context,
}: {
  filePath: string;
  context?: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolvedFilePath = yield* fs.realPath(path.resolve(filePath));
  const containerfile = yield* fs.readFileString(resolvedFilePath);
  yield* fs.writeFileString(
    resolvedFilePath,
    `${containerfile}${containerfile.endsWith("\n") ? "" : "\n"}${encodeInstruction(
      defaultCommand,
    )}\n`,
  );

  const resolvedContext =
    context === undefined
      ? path.dirname(resolvedFilePath)
      : yield* fs.realPath(path.resolve(context));

  return new ContainerfileTemplate({
    filePath: resolvedFilePath,
    context: resolvedContext,
  });
});

export class Snapshot extends Data.Class<{
  /**
   * The name of the snapshot.
   * Guaranteed to be unique and can be used to reference the real snapshot in the provider's storage.
   */
  name: string;
}> {}
