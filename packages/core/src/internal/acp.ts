import type {
  ContentBlock,
  PromptCapabilities,
  PromptRequest,
  Stream as AcpStream,
} from "@agentclientprotocol/sdk";
import {
  createHttpStream,
  type HttpStreamOptions,
} from "@agentclientprotocol/sdk/experimental/http-client";
import {
  createWebSocketStream,
  type WebSocketStreamOptions,
} from "@agentclientprotocol/sdk/experimental/ws-client";
import { Effect, Encoding, Option, Result } from "effect";
import { Prompt } from "effect/unstable/ai";
import { AcpError, type PromptCapability, PromptError, PromptErrorReason } from "#/Acp.ts";

const ignorePromiseFailure = (evaluate: () => Promise<void>) =>
  Effect.tryPromise(evaluate).pipe(Effect.ignore);

const closeStream = (stream: AcpStream) => ignorePromiseFailure(() => stream.writable.close());

const acquireStream = (url: URL, make: () => AcpStream) =>
  Effect.acquireRelease(
    Effect.try({ try: make, catch: AcpError.http(url.href, "connect") }),
    closeStream,
  );

const parseUrl = (
  input: string | URL,
  protocols: ReadonlyArray<string>,
): Effect.Effect<URL, AcpError> => {
  const displayUrl = typeof input === "string" ? input : input.href;
  return Effect.try({
    try: () => {
      const url = new URL(input);
      if (!protocols.includes(url.protocol)) {
        throw new globalThis.Error(`ACP transport requires a ${protocols.join(" or ")} URL`);
      }
      return url;
    },
    catch: AcpError.http(displayUrl, "parse-url"),
  });
};

const responseDetail = async (response: Response): Promise<string> => {
  const body = await response.text().catch(() => "");
  const summary = `${response.status} ${response.statusText}`.trim();
  return body.length === 0 ? summary : `${summary}: ${body}`;
};

const checkedFetch =
  (url: URL, fetch: typeof globalThis.fetch | undefined) =>
  async (...args: Parameters<typeof globalThis.fetch>): Promise<Response> => {
    let response: Response;
    try {
      response = await (fetch ?? globalThis.fetch)(...args);
    } catch (cause) {
      throw AcpError.http(url.href, "request")(cause);
    }
    if (!response.ok) {
      throw AcpError.httpResponse(url.href, response.status, await responseDetail(response));
    }
    return response;
  };

const openSdkHttpStream = (url: URL, options: HttpStreamOptions) =>
  acquireStream(url, () =>
    createHttpStream(url.href, {
      ...options,
      fetch: checkedFetch(url, options.fetch),
    }),
  );

const openSdkWebSocketStream = (url: URL, options: WebSocketStreamOptions) =>
  acquireStream(url, () => createWebSocketStream(url.href, options));

export const openHttpStream = Effect.fn("Acp.openHttpStream")(function* (
  input: string | URL,
  options: HttpStreamOptions = {},
) {
  const url = yield* parseUrl(input, ["http:", "https:"]);
  return yield* openSdkHttpStream(url, options);
});

export const openWebSocketStream = Effect.fn("Acp.openWebSocketStream")(function* (
  input: string | URL,
  options: WebSocketStreamOptions = {},
) {
  const url = yield* parseUrl(input, ["ws:", "wss:"]);
  return yield* openSdkWebSocketStream(url, options);
});

export const openStream = Effect.fn("Acp.openStream")(function* (
  input: string | URL,
  options: HttpStreamOptions & WebSocketStreamOptions = {},
) {
  const url = yield* parseUrl(input, ["http:", "https:", "ws:", "wss:"]);
  return yield* url.protocol === "http:" || url.protocol === "https:"
    ? openSdkHttpStream(url, options)
    : openSdkWebSocketStream(url, options);
});

export { type HttpStreamOptions, type WebSocketStreamOptions };

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
