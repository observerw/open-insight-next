import type { ContentBlock, SessionUpdate, ToolKind } from "@agentclientprotocol/sdk";
import { Encoding, Result, Schema, Stream } from "effect";
import { Response } from "effect/unstable/ai";

type SegmentKind = "text" | "reasoning";

type AgentChunkUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" }
>;

type UsageUpdate = Extract<SessionUpdate, { sessionUpdate: "usage_update" }>;

type State = Readonly<{
  active: Readonly<Record<SegmentKind, string | undefined>>;
  fallbackIndexes: Readonly<Record<SegmentKind, number>>;
  toolNames: ReadonlyMap<string, string>;
  usage: UsageUpdate | undefined;
}>;

const initialState = (): State => ({
  active: {
    text: undefined,
    reasoning: undefined,
  },
  fallbackIndexes: {
    text: 0,
    reasoning: 0,
  },
  toolNames: new Map(),
  usage: undefined,
});

const streamEnd = Symbol("AcpStreamEnd");

const streamCompleteMetadata: Response.ProviderMetadata = {
  acp: {
    sessionUpdate: "stream_complete",
  },
};

type StreamPart = Response.StreamPartView<{}>;

const emptyUsage = (): Response.Usage =>
  new Response.Usage({
    inputTokens: {
      uncached: undefined,
      total: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: undefined,
      text: undefined,
      reasoning: undefined,
    },
  });

const omittedJsonValue = { omitted: true } as const;

const jsonSafe = (value: unknown, ancestors = new Set<object>()): Schema.Json => {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : omittedJsonValue;
    case "object": {
      if (value === null) {
        return value;
      }
      if (ancestors.has(value)) {
        return omittedJsonValue;
      }

      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          return value.map((item) => jsonSafe(item, ancestors));
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          return omittedJsonValue;
        }
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, jsonSafe(item, ancestors)]),
        );
      } catch {
        return omittedJsonValue;
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      return omittedJsonValue;
  }
};

const acpMetadata = (update: SessionUpdate): Response.ProviderMetadata => ({
  acp: jsonSafe(update),
});

const finishMetadata = (update: UsageUpdate | undefined): Response.ProviderMetadata =>
  update === undefined ? streamCompleteMetadata : acpMetadata(update);

const metadataPart = (metadata: Response.ProviderMetadata): Response.ResponseMetadataPart =>
  Response.makePart("response-metadata", { metadata });

const finishPart = (update: UsageUpdate | undefined): Response.FinishPart =>
  Response.makePart("finish", {
    reason: "unknown",
    usage:
      update === undefined
        ? emptyUsage()
        : new Response.Usage({
            inputTokens: {
              uncached: undefined,
              total: update.used,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: undefined,
              text: undefined,
              reasoning: undefined,
            },
          }),
    metadata: finishMetadata(update),
  });

const segmentStartPart = (
  kind: SegmentKind,
  id: string,
  metadata: Response.ProviderMetadata,
): Response.TextStartPart | Response.ReasoningStartPart =>
  kind === "text"
    ? Response.makePart("text-start", { id, metadata })
    : Response.makePart("reasoning-start", { id, metadata });

const segmentDeltaPart = (
  kind: SegmentKind,
  id: string,
  delta: string,
  metadata: Response.ProviderMetadata,
): Response.TextDeltaPart | Response.ReasoningDeltaPart =>
  kind === "text"
    ? Response.makePart("text-delta", { id, delta, metadata })
    : Response.makePart("reasoning-delta", { id, delta, metadata });

const segmentEndPart = (
  kind: SegmentKind,
  id: string,
  metadata: Response.ProviderMetadata,
): Response.TextEndPart | Response.ReasoningEndPart =>
  kind === "text"
    ? Response.makePart("text-end", { id, metadata })
    : Response.makePart("reasoning-end", { id, metadata });

const base64ToBytes = (data: string): Uint8Array | undefined =>
  Result.match(Encoding.decodeBase64(data), {
    onFailure: () => undefined,
    onSuccess: (bytes) => bytes,
  });

const filePartFromBase64 = (
  data: string,
  mediaType: string,
  metadata: Response.ProviderMetadata,
): ReadonlyArray<StreamPart> => {
  const bytes = base64ToBytes(data);
  return bytes === undefined
    ? [metadataPart(metadata)]
    : [Response.makePart("file", { mediaType, data: bytes, metadata })];
};

const contentBlockToParts = (
  content: ContentBlock,
  metadata: Response.ProviderMetadata,
): ReadonlyArray<StreamPart> => {
  switch (content.type) {
    case "image":
    case "audio":
      return filePartFromBase64(content.data, content.mimeType, metadata);
    case "resource":
      return "blob" in content.resource
        ? filePartFromBase64(
            content.resource.blob,
            content.resource.mimeType ?? "application/octet-stream",
            metadata,
          )
        : [metadataPart(metadata)];
    case "resource_link":
    case "text":
      return [metadataPart(metadata)];
  }
};

const programmaticToolName = (name: string | null | undefined): string | undefined => {
  const normalized = name?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
};

const inferToolName = (
  kind: ToolKind | null | undefined,
  title: string | null | undefined,
  fallback: string,
): string => {
  if (kind !== undefined && kind !== null) {
    return kind;
  }

  const normalized = (title ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : fallback;
};

const fallbackToolName = (toolCallId: string): string => {
  const normalized = toolCallId.replaceAll(/[^a-zA-Z0-9_]+/g, "_");
  return normalized.length > 0 ? `acp_tool_${normalized}` : "acp_tool";
};

const toolCallPart = (
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call" }>,
  name: string,
  metadata: Response.ProviderMetadata,
): Response.AnyToolCallPart =>
  Response.anyToolCallPart({
    id: update.toolCallId,
    name,
    params: jsonSafe(
      update.rawInput === undefined
        ? {
            title: update.title,
            kind: update.kind ?? null,
          }
        : update.rawInput,
    ),
    providerExecuted: true,
    metadata,
  });

const toolResultPart = (
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
  name: string,
  metadata: Response.ProviderMetadata,
): Response.AnyToolResultPart => {
  const result = jsonSafe(
    update.rawOutput ??
      update.content ??
      update.locations ?? {
        status: update.status ?? null,
      },
  );

  return Response.anyToolResultPart({
    id: update.toolCallId,
    name,
    isFailure: update.status === "failed",
    result,
    encodedResult: result,
    providerExecuted: true,
    preliminary: update.status !== "completed" && update.status !== "failed",
    metadata,
  });
};

const chunkKind = (update: AgentChunkUpdate): SegmentKind =>
  update.sessionUpdate === "agent_message_chunk" ? "text" : "reasoning";

const nextChunkId = (
  state: State,
  update: AgentChunkUpdate,
  kind: SegmentKind,
): readonly [State, string] => {
  if (update.messageId !== undefined && update.messageId !== null) {
    return [state, update.messageId];
  }

  const activeId = state.active[kind];
  if (activeId !== undefined) {
    return [state, activeId];
  }

  const index = state.fallbackIndexes[kind] + 1;
  const prefix = kind === "text" ? "acp-agent-message" : "acp-agent-thought";
  return [
    {
      ...state,
      fallbackIndexes: {
        ...state.fallbackIndexes,
        [kind]: index,
      },
    },
    `${prefix}-${index}`,
  ];
};

const setActiveSegment = (state: State, kind: SegmentKind, id: string | undefined): State => ({
  ...state,
  active: {
    ...state.active,
    [kind]: id,
  },
});

const closeSegment = (
  state: State,
  kind: SegmentKind,
  metadata: Response.ProviderMetadata,
): readonly [State, ReadonlyArray<StreamPart>] => {
  const activeId = state.active[kind];
  if (activeId === undefined) {
    return [state, []];
  }

  return [setActiveSegment(state, kind, undefined), [segmentEndPart(kind, activeId, metadata)]];
};

const handleAgentChunk = (
  state: State,
  update: AgentChunkUpdate,
  metadata: Response.ProviderMetadata,
): readonly [State, ReadonlyArray<StreamPart>] => {
  const kind = chunkKind(update);
  if (update.content.type !== "text") {
    return [state, contentBlockToParts(update.content, metadata)];
  }

  const [stateWithId, id] = nextChunkId(state, update, kind);
  const activeId = stateWithId.active[kind];
  const startsSegment = activeId !== id;
  const closedParts: ReadonlyArray<StreamPart> =
    activeId !== undefined && startsSegment ? [segmentEndPart(kind, activeId, metadata)] : [];
  const nextState = startsSegment ? setActiveSegment(stateWithId, kind, id) : stateWithId;

  return [
    nextState,
    [
      ...closedParts,
      ...(startsSegment ? [segmentStartPart(kind, id, metadata)] : []),
      segmentDeltaPart(kind, id, update.content.text, metadata),
    ],
  ];
};

const handleToolCall = (
  state: State,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call" }>,
  metadata: Response.ProviderMetadata,
): readonly [State, ReadonlyArray<StreamPart>] => {
  const name =
    programmaticToolName(update.name) ?? inferToolName(update.kind, update.title, "acp_tool");
  const toolNames = new Map(state.toolNames);
  toolNames.set(update.toolCallId, name);
  return [
    {
      ...state,
      toolNames,
    },
    [toolCallPart(update, name, metadata)],
  ];
};

const handleToolCallUpdate = (
  state: State,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
  metadata: Response.ProviderMetadata,
): readonly [State, ReadonlyArray<StreamPart>] => {
  const existingName = state.toolNames.get(update.toolCallId);
  const name =
    programmaticToolName(update.name) ??
    existingName ??
    inferToolName(update.kind, update.title, fallbackToolName(update.toolCallId));

  if (existingName === name) {
    return [state, [toolResultPart(update, name, metadata)]];
  }

  const toolNames = new Map(state.toolNames);
  toolNames.set(update.toolCallId, name);
  return [{ ...state, toolNames }, [toolResultPart(update, name, metadata)]];
};

const handleUpdate = (
  state: State,
  update: SessionUpdate,
): readonly [State, ReadonlyArray<StreamPart>] => {
  if (update.sessionUpdate === "usage_update") {
    return [{ ...state, usage: update }, []];
  }

  const metadata = acpMetadata(update);
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return handleAgentChunk(state, update, metadata);
    case "tool_call":
      return handleToolCall(state, update, metadata);
    case "tool_call_update":
      return handleToolCallUpdate(state, update, metadata);
    case "user_message_chunk":
    case "plan":
    case "plan_update":
    case "plan_removed":
    case "available_commands_update":
    case "current_mode_update":
    case "config_option_update":
    case "session_info_update":
      return [state, [metadataPart(metadata)]];
    default:
      return [state, [metadataPart(metadata)]];
  }
};

const closeStream = (state: State): ReadonlyArray<StreamPart> => {
  const [stateWithoutText, textParts] = closeSegment(state, "text", streamCompleteMetadata);
  const [_closedState, reasoningParts] = closeSegment(
    stateWithoutText,
    "reasoning",
    streamCompleteMetadata,
  );
  return [...textParts, ...reasoningParts, finishPart(state.usage)];
};

const handleStreamEvent = (
  state: State,
  event: SessionUpdate | typeof streamEnd,
): readonly [State, ReadonlyArray<StreamPart>] =>
  event === streamEnd ? [state, closeStream(state)] : handleUpdate(state, event);

export const transform = <E, R>(
  stream: Stream.Stream<SessionUpdate, E, R>,
): Stream.Stream<StreamPart, E, R> =>
  stream.pipe(
    Stream.concat(Stream.succeed(streamEnd)),
    Stream.mapAccum(initialState, handleStreamEvent),
  );
