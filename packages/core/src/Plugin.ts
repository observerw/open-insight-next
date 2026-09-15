import { Effect, FileSystem, Option, Path, Schema } from "effect";

export const PluginSchemaId = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

export class InvalidPath extends Schema.TaggedError<InvalidPath>(
  "open-insight/PluginError/InvalidPath",
)("InvalidPath", {
  path: Schema.String,
}) {
  override get message(): string {
    return `Cannot use "${this.path}" as a plugin root`;
  }
}

export class MissingManifest extends Schema.TaggedError<MissingManifest>(
  "open-insight/PluginError/MissingManifest",
)("MissingManifest", {
  path: Schema.String,
}) {
  override get message(): string {
    return `No plugin.json manifest found at plugin root "${this.path}"`;
  }
}

export class UnsupportedSchema extends Schema.TaggedError<UnsupportedSchema>(
  "open-insight/PluginError/UnsupportedSchema",
)("UnsupportedSchema", {
  found: Schema.optionalKey(Schema.String),
}) {
  override get message(): string {
    const found = this.found === undefined ? "missing" : `"${this.found}"`;

    return `Unsupported plugin manifest $schema ${found}; expected ${PluginSchemaId}`;
  }
}

export class InvalidManifest extends Schema.TaggedError<InvalidManifest>(
  "open-insight/PluginError/InvalidManifest",
)("InvalidManifest", {
  field: Schema.optionalKey(Schema.String),
}) {
  override get message(): string {
    const where = this.field === undefined ? "manifest" : `manifest field "${this.field}"`;

    return `Invalid ${where}`;
  }
}

export const ErrorReason = Schema.Union([
  InvalidPath,
  MissingManifest,
  UnsupportedSchema,
  InvalidManifest,
]);

export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class PluginError extends Schema.TaggedError<PluginError>("open-insight/PluginError")(
  "PluginError",
  { reason: ErrorReason },
) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static invalidPath = (path: string): PluginError =>
    PluginError.make({ reason: InvalidPath.make({ path }) });

  static missingManifest = (path: string): PluginError =>
    PluginError.make({ reason: MissingManifest.make({ path }) });

  static unsupportedSchema = (found?: string): PluginError =>
    PluginError.make({
      reason: UnsupportedSchema.make(found === undefined ? {} : { found }),
    });

  static invalidManifest = (field?: string): PluginError =>
    PluginError.make({
      reason: InvalidManifest.make(field === undefined ? {} : { field }),
    });
}

/** Fixed location, relative to the plugin root, where skills are discovered. */
export const SkillsDir = "skills";

/** Fixed location, relative to the plugin root, of the MCP configuration document. */
export const McpConfigFile = "mcp.json";

/** Fixed file name of a skill's frontmatter-and-instructions document. */
export const SkillMarkdownFile = "SKILL.md";

/** Canonical name format: 1–64 lowercase ASCII letters/digits/hyphens/periods. */
export const PluginNamePattern = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

/** The canonical manifest schema identifier as a decodeable Schema. */
export const ManifestSchemaId = Schema.Literal(PluginSchemaId);

/** A valid plugin name, per the canonical `name` pattern. */
export const PluginName = Schema.String.check(
  Schema.isPattern(PluginNamePattern, { expected: "a valid plugin name" }),
);

export type PluginName = Schema.Schema.Type<typeof PluginName>;

/** Closed `author` object of the manifest. */
export const Author = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
});

export type Author = Schema.Schema.Type<typeof Author>;

/**
 * Schema for the known optional top-level manifest fields.
 *
 * The closed Agent Plugins manifest defines `$schema` and `name` as required
 * (handled by the loader with dedicated errors) and these fields as optional
 * metadata. Two violations are intentionally non-fatal and are handled by the
 * loader before this schema runs: unknown top-level fields and a non-object
 * `extensions` value.
 */
export const Manifest = Schema.Struct({
  version: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  author: Schema.optionalKey(Author),
  homepage: Schema.optionalKey(Schema.String),
  repository: Schema.optionalKey(Schema.String),
  license: Schema.optionalKey(Schema.String),
  keywords: Schema.optionalKey(Schema.Array(Schema.String)),
  extensions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export type Manifest = Schema.Schema.Type<typeof Manifest>;

/** Every top-level field the closed manifest permits. */
export const KnownManifestFields = ["$schema", "name", ...Object.keys(Manifest.fields)] as const;

/** A discovered skill component of a validated plugin. */
export class PluginSkill extends Schema.Class<PluginSkill>("PluginSkill")({
  name: Schema.String,
  path: Schema.String,
}) {}

/** A discovered MCP server entry of a validated plugin. */
export class PluginMcpServer extends Schema.Class<PluginMcpServer>("PluginMcpServer")({
  name: Schema.String,
}) {}

/**
 * A plugin whose `plugin.json` manifest passed validation, bundled with its
 * filesystem-resolved directory path and parsed metadata.
 */
export class Plugin extends Schema.Class<Plugin>("Plugin")({
  /** Filesystem-resolved plugin directory path, with symlinks followed. */
  root: Schema.String,
  name: Schema.String,
  version: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  author: Schema.optionalKey(Author),
  homepage: Schema.optionalKey(Schema.String),
  repository: Schema.optionalKey(Schema.String),
  license: Schema.optionalKey(Schema.String),
  keywords: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Client-owned manifest data keyed by reverse-domain namespace. */
  extensions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  /** Discovered skills under the fixed `skills/` location. */
  skills: Schema.Array(PluginSkill),
  /** Discovered MCP servers declared in `mcp.json`. */
  mcpServers: Schema.Array(PluginMcpServer),
  /** Non-fatal manifest and component issues that were reported and ignored. */
  warnings: Schema.Array(Schema.String),
}) {}

/** The schema for a JSON object (used for both the manifest and `mcp.json`). */
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

/** Decode a JSON document string into a validated JSON object. */
const parseJsonObject = (raw: string, label: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(JsonObject))(raw).pipe(
    Effect.mapError(() => PluginError.invalidManifest(label)),
  );

/**
 * Validate a portable Agent Plugin at `pluginDir`.
 *
 * Follows the Agent Plugins loading sequence: establish the filesystem-resolved
 * root, locate and validate the root `plugin.json` manifest against the
 * locally-supported `$schema`, discover supported component types from their
 * fixed locations, and apply failure boundaries. Returns the validated `Plugin`
 * data structure (directory path + resolved metadata), or fails with a
 * `PluginError` for fatal violations.
 */
export const validate = Effect.fn(function* (pluginDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const warnings: string[] = [];

  // 1. Establish the filesystem-resolved plugin root.
  const root = yield* fs
    .realPath(path.resolve(pluginDir))
    .pipe(Effect.mapError(() => PluginError.invalidPath(pluginDir)));

  // 2. Locate, parse and validate the manifest at the root.
  const manifestPath = path.join(root, "plugin.json");

  const manifestExists = yield* fs
    .exists(manifestPath)
    .pipe(Effect.mapError(() => PluginError.invalidManifest("plugin.json")));

  if (!manifestExists) {
    yield* Effect.fail(PluginError.missingManifest(root));
  }

  const resolvedManifest = yield* fs
    .realPath(manifestPath)
    .pipe(Effect.mapError(() => PluginError.invalidManifest("plugin.json")));

  if (path.relative(root, resolvedManifest).startsWith("..")) {
    yield* Effect.fail(PluginError.invalidManifest("plugin.json"));
  }

  const rawManifest = yield* fs
    .readFileString(manifestPath)
    .pipe(Effect.mapError(() => PluginError.invalidManifest("plugin.json")));

  const parsed = yield* parseJsonObject(rawManifest, "plugin.json");

  // 3. Non-fatal: report and ignore unknown top-level fields.
  const knownFields = new Set<string>(KnownManifestFields);

  for (const key of Object.keys(parsed)) {
    if (!knownFields.has(key)) {
      warnings.push(`Ignoring unknown manifest field "${key}"`);
    }
  }

  // 4. Non-fatal: report and ignore a non-object `extensions` value.
  const extensionsInvalid = Option.isNone(
    Schema.decodeUnknownOption(JsonObject)(parsed["extensions"]),
  );

  if (extensionsInvalid) {
    warnings.push('Ignoring non-object manifest field "extensions"');
  }

  // 5. Fatal: the manifest must declare a supported canonical schema.
  const schemaId = Schema.decodeUnknownOption(Schema.String)(parsed["$schema"]);

  if (Option.isNone(schemaId)) {
    yield* Effect.fail(PluginError.unsupportedSchema());
  } else if (Option.isNone(Schema.decodeUnknownOption(ManifestSchemaId)(schemaId.value))) {
    yield* Effect.fail(PluginError.unsupportedSchema(schemaId.value));
  }

  // 6. Fatal: the manifest must declare a valid plugin name.
  const name = yield* Schema.decodeUnknownEffect(PluginName)(parsed["name"]).pipe(
    Effect.mapError(() => PluginError.invalidManifest("name")),
  );

  // 7. Fatal: any other manifest schema violation (optional field types).
  const metadataInput = { ...parsed };

  if (extensionsInvalid) delete metadataInput.extensions;

  const metadata = yield* Schema.decodeUnknownEffect(Manifest)(metadataInput).pipe(
    Effect.mapError(() => PluginError.invalidManifest()),
  );

  // 8. Discover supported component types from their fixed locations, applying
  // the narrowest failure boundary: a broken component type disables only that
  // type (a warning) and never rejects the plugin.

  // Skills: immediate children of skills/ containing a regular SKILL.md.
  const skills: PluginSkill[] = [];
  yield* Effect.gen(function* () {
    const dir = path.join(root, SkillsDir);

    if (!(yield* fs.exists(dir))) return;

    if ((yield* fs.stat(dir)).type !== "Directory") {
      warnings.push('Ignoring "skills" location: not a directory');

      return;
    }

    for (const entry of yield* fs.readDirectory(dir)) {
      const markdown = path.join(dir, entry, SkillMarkdownFile);

      if (!(yield* fs.exists(markdown))) continue;

      if ((yield* fs.stat(markdown)).type === "File") {
        skills.push(new PluginSkill({ name: entry, path: path.join(dir, entry) }));
      } else {
        warnings.push(`Skipping skill "${entry}": ${SkillMarkdownFile} is not a regular file`);
      }
    }
  }).pipe(
    Effect.catch(() =>
      Effect.sync(() => warnings.push('Ignoring "skills" components: discovery failed')),
    ),
  );

  // MCP servers: one root mcp.json document. A broken document disables MCP;
  // an invalid entry disables only that entry.
  const mcpServers: PluginMcpServer[] = [];
  yield* Effect.gen(function* () {
    const file = path.join(root, McpConfigFile);

    if (!(yield* fs.exists(file))) return;

    if ((yield* fs.stat(file)).type !== "File") {
      warnings.push('Ignoring "mcp.json": not a regular file');

      return;
    }

    const mcpRaw = yield* fs.readFileString(file);
    const mcpParsed = yield* parseJsonObject(mcpRaw, "mcp.json");
    const servers = Schema.decodeUnknownOption(JsonObject)(mcpParsed["mcpServers"]);

    if (Option.isNone(servers)) {
      warnings.push('Ignoring "mcp.json": invalid MCP configuration');

      return;
    }

    for (const [serverName, value] of Object.entries(servers.value)) {
      if (Schema.is(JsonObject)(value)) {
        mcpServers.push(new PluginMcpServer({ name: serverName }));
      } else {
        warnings.push(`Skipping MCP server "${serverName}": invalid configuration`);
      }
    }
  }).pipe(
    Effect.catch(() =>
      Effect.sync(() => warnings.push('Ignoring "mcp.json": MCP configuration could not be read')),
    ),
  );

  return new Plugin({ root, name, ...metadata, skills, mcpServers, warnings });
});
