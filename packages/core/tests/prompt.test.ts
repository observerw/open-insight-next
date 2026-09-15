import { assert, describe, it } from "@effect/vitest";
import { Effect, Encoding } from "effect";
import { Prompt } from "effect/unstable/ai";
import { AcpError } from "#/Acp.ts";
import { toAcpPrompt } from "#/internal/acp.ts";

const message = (...content: ReadonlyArray<Prompt.UserMessagePart>): Prompt.UserMessage =>
  Prompt.userMessage({ content });

const text = (value: string): Prompt.TextPart => Prompt.textPart({ text: value });

const file = (
  mediaType: string,
  data: string | Uint8Array | URL,
  fileName?: string,
): Prompt.FilePart =>
  Prompt.filePart({
    mediaType,
    data,
    ...(fileName === undefined ? {} : { fileName }),
  });

const promptError = (error: AcpError) => {
  assert.strictEqual(error.reason._tag, "PromptError");
  if (error.reason._tag !== "PromptError") {
    assert.fail(`Expected PromptError, received ${error.reason._tag}`);
  }
  return error.reason;
};

describe("toAcpPrompt", () => {
  it.effect("preserves empty content and ordered text block boundaries", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* toAcpPrompt(message()), []);

      const result = yield* toAcpPrompt(message(text(""), text("  hello\n"), text("world")));

      assert.deepStrictEqual(result, [
        { type: "text", text: "" },
        { type: "text", text: "  hello\n" },
        { type: "text", text: "world" },
      ]);
    }),
  );

  it.effect("maps URL data to baseline resource links without fetching", () =>
    Effect.gen(function* () {
      const result = yield* toAcpPrompt(
        message(
          file("text/plain", new URL("https://example.test/files/report%20one.txt")),
          file("application/json", new URL("https://example.test/")),
          file("text/plain", new URL("https://example.test/%E0%A4%A")),
          file("application/octet-stream", new URL("urn:example:item")),
          file("text/markdown", new URL("https://example.test/ignored.md"), "README.md"),
        ),
      );

      assert.deepStrictEqual(result, [
        {
          type: "resource_link",
          name: "report one.txt",
          uri: "https://example.test/files/report%20one.txt",
          mimeType: "text/plain",
        },
        {
          type: "resource_link",
          name: "example.test",
          uri: "https://example.test/",
          mimeType: "application/json",
        },
        {
          type: "resource_link",
          name: "%E0%A4%A",
          uri: "https://example.test/%E0%A4%A",
          mimeType: "text/plain",
        },
        {
          type: "resource_link",
          name: "urn",
          uri: "urn:example:item",
          mimeType: "application/octet-stream",
        },
        {
          type: "resource_link",
          name: "README.md",
          uri: "https://example.test/ignored.md",
          mimeType: "text/markdown",
        },
      ]);
    }),
  );

  it.effect("encodes image and audio bytes when their capabilities are enabled", () =>
    Effect.gen(function* () {
      const result = yield* toAcpPrompt(
        message(
          file("IMAGE/PNG", new Uint8Array([0, 1, 2, 255]), "ignored.png"),
          file("Audio/Wav", Encoding.encodeBase64(new Uint8Array([3, 4, 5]))),
        ),
        { promptCapabilities: { image: true, audio: true } },
      );

      assert.deepStrictEqual(result, [
        {
          type: "image",
          data: "AAEC/w==",
          mimeType: "IMAGE/PNG",
        },
        {
          type: "audio",
          data: "AwQF",
          mimeType: "Audio/Wav",
        },
      ]);
    }),
  );

  it.effect("unwraps base64 data URLs and compares media types case-insensitively", () =>
    Effect.gen(function* () {
      const result = yield* toAcpPrompt(message(file("image/PNG", "DATA:IMAGE/png;BASE64,aGk=")), {
        promptCapabilities: { image: true },
      });

      assert.deepStrictEqual(result, [
        {
          type: "image",
          data: "aGk=",
          mimeType: "image/PNG",
        },
      ]);
    }),
  );

  it.effect("maps generic bytes to deterministic embedded resources with filename metadata", () =>
    Effect.gen(function* () {
      const result = yield* toAcpPrompt(
        message(text("context"), file("application/pdf", new Uint8Array([]), "report.pdf")),
        { promptCapabilities: { embeddedContext: true } },
      );

      assert.deepStrictEqual(result, [
        { type: "text", text: "context" },
        {
          type: "resource",
          resource: {
            uri: "urn:open-insight:prompt-file:1",
            blob: "",
            mimeType: "application/pdf",
          },
          _meta: {
            "open-insight/fileName": "report.pdf",
          },
        },
      ]);
    }),
  );

  it.effect("requires explicit capabilities for non-baseline content", () =>
    Effect.gen(function* () {
      const cases = [
        [file("image/png", ""), "image"],
        [file("audio/wav", ""), "audio"],
        [file("application/pdf", ""), "embeddedContext"],
      ] as const;

      for (const [part, capability] of cases) {
        const error = yield* toAcpPrompt(message(part)).pipe(Effect.flip);
        const reason = promptError(error);

        assert.strictEqual(reason.reason, "capability_not_enabled");
        assert.strictEqual(reason.partIndex, 0);
        assert.strictEqual(reason.partType, "file");
        assert.strictEqual(reason.mediaType, part.mediaType);
        assert.strictEqual(reason.capability, capability);
        assert.strictEqual(error.message, reason.message);
        assert.strictEqual(error.cause, reason);
      }
    }),
  );

  it.effect("reports invalid raw base64 without exposing its payload", () =>
    Effect.gen(function* () {
      const payload = "not-base64!!!secret";
      const error = yield* toAcpPrompt(message(file("image/png", payload)), {
        promptCapabilities: { image: true },
      }).pipe(Effect.flip);
      const reason = promptError(error);

      assert.strictEqual(reason.reason, "invalid_base64");
      assert.strictEqual(reason.partIndex, 0);
      assert.notInclude(reason.message, payload);
    }),
  );

  it.effect("rejects malformed or parameterized data URLs", () =>
    Effect.gen(function* () {
      const inputs = [
        "data:image/png;base64",
        "data:;base64,aGk=",
        "data:image/png,aGk=",
        "data:image/png;charset=utf-8;base64,aGk=",
      ];

      for (const input of inputs) {
        const error = yield* toAcpPrompt(message(file("image/png", input)), {
          promptCapabilities: { image: true },
        }).pipe(Effect.flip);

        assert.strictEqual(promptError(error).reason, "invalid_data_url");
      }
    }),
  );

  it.effect("distinguishes data URL media type mismatch from invalid base64", () =>
    Effect.gen(function* () {
      const mismatch = yield* toAcpPrompt(
        message(file("image/png", "data:image/jpeg;base64,aGk=")),
        { promptCapabilities: { image: true } },
      ).pipe(Effect.flip);
      const invalidPayload = yield* toAcpPrompt(
        message(file("image/png", "data:image/png;base64,%%%")),
        { promptCapabilities: { image: true } },
      ).pipe(Effect.flip);

      assert.strictEqual(promptError(mismatch).reason, "data_url_media_type_mismatch");
      assert.strictEqual(promptError(invalidPayload).reason, "invalid_base64");
    }),
  );

  it.effect("fails atomically at the original part index without mutating input", () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([1, 2, 3]);
      const input = message(
        text("before"),
        file("application/octet-stream", bytes, "data.bin"),
        text("after"),
      );
      const originalContent = [...input.content];

      const error = yield* toAcpPrompt(input).pipe(Effect.flip);
      const reason = promptError(error);

      assert.strictEqual(reason.reason, "capability_not_enabled");
      assert.strictEqual(reason.partIndex, 1);
      assert.deepStrictEqual(input.content, originalContent);
      assert.deepStrictEqual(bytes, new Uint8Array([1, 2, 3]));
    }),
  );
});
