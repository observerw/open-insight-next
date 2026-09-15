import type { ContentBlock, PromptCapabilities, PromptRequest } from "@agentclientprotocol/sdk";
import { Effect, Encoding, Option, Result } from "effect";
import { Prompt } from "effect/unstable/ai";
import { AcpError, type PromptCapability, PromptError, PromptErrorReason } from "#/AcpError.ts";

export interface ToAcpPromptOptions {
  readonly promptCapabilities?: PromptCapabilities;
}

const makeError = (
  reason: typeof PromptErrorReason.Type,
  partIndex: number,
  mediaType: string,
  capability?: PromptCapability,
): PromptError =>
  PromptError.make({
    reason,
    partIndex,
    partType: "file",
    mediaType,
    ...(capability === undefined ? {} : { capability }),
  });

const requireCapability = (
  capabilities: PromptCapabilities | undefined,
  capability: PromptCapability,
  partIndex: number,
  mediaType: string,
): Effect.Effect<void, PromptError> =>
  capabilities?.[capability] === true
    ? Effect.void
    : Effect.fail(makeError("capability_not_enabled", partIndex, mediaType, capability));

const normalizeBase64 = (
  input: string,
  partIndex: number,
  mediaType: string,
): Effect.Effect<string, PromptError> =>
  Result.match(Encoding.decodeBase64(input), {
    onFailure: () => Effect.fail(makeError("invalid_base64", partIndex, mediaType)),
    onSuccess: (bytes) => Effect.succeed(Encoding.encodeBase64(bytes)),
  });

const normalizeDataString = (
  input: string,
  partIndex: number,
  mediaType: string,
): Effect.Effect<string, PromptError> => {
  if (input.slice(0, 5).toLowerCase() !== "data:") {
    return normalizeBase64(input, partIndex, mediaType);
  }

  const commaIndex = input.indexOf(",");
  if (commaIndex === -1) {
    return Effect.fail(makeError("invalid_data_url", partIndex, mediaType));
  }

  const header = input.slice(5, commaIndex);
  const headerParts = header.split(";");
  if (
    headerParts.length !== 2 ||
    headerParts[0]?.length === 0 ||
    headerParts[1]?.toLowerCase() !== "base64"
  ) {
    return Effect.fail(makeError("invalid_data_url", partIndex, mediaType));
  }

  if (headerParts[0].toLowerCase() !== mediaType.toLowerCase()) {
    return Effect.fail(makeError("data_url_media_type_mismatch", partIndex, mediaType));
  }

  return normalizeBase64(input.slice(commaIndex + 1), partIndex, mediaType);
};

const fileBase64 = (
  data: string | Uint8Array,
  partIndex: number,
  mediaType: string,
): Effect.Effect<string, PromptError> =>
  data instanceof Uint8Array
    ? Effect.succeed(Encoding.encodeBase64(data))
    : normalizeDataString(data, partIndex, mediaType);

const decodeUriComponent = Option.liftThrowable(globalThis.decodeURIComponent);

const resourceName = (part: Prompt.FilePart, url: URL): string => {
  if (part.fileName !== undefined && part.fileName.length > 0) {
    return part.fileName;
  }

  const isHierarchical = url.host.length > 0 || url.protocol === "file:";
  const pathSegment = isHierarchical
    ? url.pathname
        .split("/")
        .filter((segment) => segment.length > 0)
        .at(-1)
    : undefined;

  if (pathSegment !== undefined) {
    return Option.getOrElse(decodeUriComponent(pathSegment), () => pathSegment);
  }
  if (url.host.length > 0) {
    return url.host;
  }
  if (url.protocol.length > 1) {
    return url.protocol.slice(0, -1);
  }
  return "resource";
};

const resourceLink = (part: Prompt.FilePart, url: URL): ContentBlock => ({
  type: "resource_link",
  name: resourceName(part, url),
  uri: url.toString(),
  mimeType: part.mediaType,
});

const imageBlock = (part: Prompt.FilePart, data: string): ContentBlock => ({
  type: "image",
  data,
  mimeType: part.mediaType,
});

const audioBlock = (part: Prompt.FilePart, data: string): ContentBlock => ({
  type: "audio",
  data,
  mimeType: part.mediaType,
});

const blobBlock = (part: Prompt.FilePart, partIndex: number, data: string): ContentBlock => ({
  type: "resource",
  resource: {
    uri: `urn:open-insight:prompt-file:${partIndex}`,
    blob: data,
    mimeType: part.mediaType,
  },
  ...(part.fileName === undefined
    ? {}
    : {
        _meta: {
          "open-insight/fileName": part.fileName,
        },
      }),
});

const fileToContentBlock = Effect.fn(function* (
  part: Prompt.FilePart,
  partIndex: number,
  capabilities: PromptCapabilities | undefined,
): Effect.fn.Return<ContentBlock, PromptError> {
  if (part.data instanceof URL) {
    return resourceLink(part, part.data);
  }

  const normalizedMediaType = part.mediaType.toLowerCase();
  if (normalizedMediaType.startsWith("image/")) {
    yield* requireCapability(capabilities, "image", partIndex, part.mediaType);
    return imageBlock(part, yield* fileBase64(part.data, partIndex, part.mediaType));
  }
  if (normalizedMediaType.startsWith("audio/")) {
    yield* requireCapability(capabilities, "audio", partIndex, part.mediaType);
    return audioBlock(part, yield* fileBase64(part.data, partIndex, part.mediaType));
  }

  yield* requireCapability(capabilities, "embeddedContext", partIndex, part.mediaType);
  return blobBlock(part, partIndex, yield* fileBase64(part.data, partIndex, part.mediaType));
});

export const toAcpPrompt = Effect.fn("Acp.toAcpPrompt")(
  (
    message: Prompt.UserMessage,
    options: ToAcpPromptOptions = {},
  ): Effect.Effect<PromptRequest["prompt"], AcpError> =>
    Effect.mapError(
      Effect.forEach(message.content, (part, partIndex) =>
        part.type === "text"
          ? Effect.succeed<ContentBlock>({
              type: "text",
              text: part.text,
            })
          : fileToContentBlock(part, partIndex, options.promptCapabilities),
      ),
      AcpError.prompt,
    ),
);
