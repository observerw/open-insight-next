import { Schema } from "effect";
import { PluginSchemaId } from "./PluginConstants.ts";

/** The plugin root path could not be resolved to a real, usable filesystem location. */
export class InvalidPath extends Schema.TaggedError<InvalidPath>(
  "open-insight/PluginError/InvalidPath",
)("InvalidPath", {
  path: Schema.String,
}) {
  override get message(): string {
    return `Cannot use "${this.path}" as a plugin root`;
  }
}

/** The root `plugin.json` manifest is missing. */
export class MissingManifest extends Schema.TaggedError<MissingManifest>(
  "open-insight/PluginError/MissingManifest",
)("MissingManifest", {
  path: Schema.String,
}) {
  override get message(): string {
    return `No plugin.json manifest found at plugin root "${this.path}"`;
  }
}

/** The manifest's `$schema` is missing or not a canonical identifier this client supports. */
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

/** The manifest violates a fatal schema rule (unparseable JSON, wrong shape, bad name or field types). */
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

/** The fatal validation channel returned by plugin discovery. */
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
