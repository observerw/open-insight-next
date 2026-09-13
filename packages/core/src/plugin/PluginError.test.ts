import { assert, it } from "@effect/vitest";
import { Effect, Match, Schema } from "effect";
import {
  InvalidManifest,
  InvalidPath,
  MissingManifest,
  PluginError,
  UnsupportedSchema,
} from "./PluginError.ts";

it("constructs independent tagged plugin errors without native causes", () => {
  const reasons = [
    InvalidPath.make({ path: "/plugins/example" }),
    MissingManifest.make({ path: "/plugins/example" }),
    UnsupportedSchema.make({ found: "https://example.test/schema.json" }),
    InvalidManifest.make({ field: "name" }),
  ];

  const error = PluginError.make({ reason: reasons[3] });

  assert.deepStrictEqual(
    reasons.map((reason) => reason._tag),
    ["InvalidPath", "MissingManifest", "UnsupportedSchema", "InvalidManifest"],
  );
  assert.strictEqual(error._tag, "PluginError");
  assert.strictEqual(error.reason._tag, "InvalidManifest");
  assert.isFalse("cause" in reasons[0]);
  assert.isFalse("cause" in reasons[3]);
});

it("handles one nested reason and preserves unmatched reasons", () => {
  const handled = Effect.runSync(
    Effect.fail(PluginError.missingManifest("/plugins/example")).pipe(
      Effect.catchReason("PluginError", "MissingManifest", (reason) => Effect.succeed(reason.path)),
    ),
  );

  assert.strictEqual(handled, "/plugins/example");

  const unsupported = PluginError.unsupportedSchema("https://example.test/schema.json");

  assert.strictEqual(unsupported.reason._tag, "UnsupportedSchema");
});

it("does not encode native causes because the public reason schema has no cause field", () => {
  const encoded = Schema.encodeSync(PluginError)(PluginError.invalidManifest("name"));
  const decoded = Schema.decodeUnknownSync(PluginError)(encoded);

  assert.strictEqual(decoded._tag, "PluginError");

  const field = Match.value(decoded.reason).pipe(
    Match.tag("InvalidManifest", (reason) => reason.field),
    Match.orElse(() => undefined),
  );

  assert.strictEqual(field, "name");
});
