import { Data, Effect, FileSystem, Path, Schema } from "effect";
import { cmd, Instruction, Instructions } from "./SnapshotInstruction.ts";

export const defaultCommand = cmd("sleep", "infinity");

/** A template described with the provider-independent instruction set. */
export class InstructionsTemplate
  extends Schema.TaggedClass<InstructionsTemplate>()(
    "Instructions",
    {
      image: Schema.String,
      instructions: Instructions,
      /** Absolute build-context directory on the host machine. */
      context: Schema.String,
    },
  ) {}

/** A template described by a Dockerfile or Containerfile on the user's machine. */
export class ContainerfileTemplate
  extends Schema.TaggedClass<ContainerfileTemplate>()(
    "Containerfile",
    {
      /** Absolute path to the Dockerfile or Containerfile on the host machine. */
      filePath: Schema.String,
      /** Absolute build-context directory on the host machine. */
      context: Schema.String,
    },
  ) {}

export const Template = Schema.Union([
  InstructionsTemplate,
  ContainerfileTemplate,
]);
export type Template = Schema.Schema.Type<typeof Template>;

export const SNAPSHOT_NAME = "open-insight-snapshot";

const encodeInstruction = (instruction: Instruction): string =>
  Instruction.match(instruction, {
    Workdir: ({ path }) => `WORKDIR ${path}`,
    User: ({ user }) => `USER ${user}`,
    Run: ({ cmd, network }) =>
      `RUN${network === undefined ? "" : ` --network=${network}`} ${cmd}`,
    Cmd: ({ cmd }) => `CMD ${JSON.stringify(cmd)}`,
    Env: ({ env }) => {
      const keys = Object.keys(env).sort();
      return `ENV ${
        keys.map((key) => `${key}=${JSON.stringify(env[key])}`).join(" ")
      }`;
    },
    Copy: ({ src, dest, from, chmod, chown, link, parents, exclude }) => {
      const options = [
        from === undefined ? undefined : `--from=${from}`,
        chmod === undefined ? undefined : `--chmod=${chmod}`,
        chown === undefined ? undefined : `--chown=${chown}`,
        link === undefined ? undefined : `--link${link ? "" : "=false"}`,
        parents === undefined
          ? undefined
          : `--parents${parents ? "" : "=false"}`,
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
}: Readonly<{
  image: string;
  instructions: Instructions;
}>): string => {
  const lines = [`FROM ${image}`, ...instructions.map(encodeInstruction)];
  return `${lines.join("\n")}\n`;
};

/** Write provider-independent instructions to a temporary Containerfile and return its path. */
export const writeInstructions = Effect.fn(
  function* (template: InstructionsTemplate) {
    const fs = yield* FileSystem.FileSystem;
    const containerfilePath = yield* fs.makeTempFile({
      prefix: "open-insight-",
      suffix: ".Containerfile",
    });
    yield* fs.writeFileString(containerfilePath, encode(template));
    return containerfilePath;
  },
);

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
    `${containerfile}${containerfile.endsWith("\n") ? "" : "\n"}${
      encodeInstruction(defaultCommand)
    }\n`,
  );
  const resolvedContext = context === undefined
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
