import {
  PROTOCOL_VERSION,
  RequestError,
  client,
  methods,
  type ActiveSession,
  type AuthenticateRequest,
  type ClientCapabilities,
  type ContentBlock,
  type Implementation,
  type InitializeResponse,
  type McpServer,
  type PromptCapabilities,
  type SessionUpdate,
  type ToolKind,
} from "@agentclientprotocol/sdk";
import { Cause, Effect, Encoding, FiberSet, Formatter, Layer, Path, Queue, Ref, Result, Schedule, Schema, Stream } from "effect";
import * as Agent from "#/Agent.ts";
import * as Prompt from "#/Prompt.ts";
import * as Response from "#/Response.ts";
import * as Sandbox from "#/Sandbox.ts";
import * as Snapshot from "#/Snapshot.ts";
import * as Bash from "#/Shell.ts";
import {
  type HttpStreamOptions,
  openStream,
  toAcpPrompt,
  type WebSocketStreamOptions,
} from "./internal/acp.ts";

export const PromptErrorReason = Schema.Literals([
  "capability_not_enabled",
  "invalid_base64",
  "invalid_data_url",
  "data_url_media_type_mismatch",
]);
export type PromptErrorReason = Schema.Schema.Type<typeof PromptErrorReason>;

export const PromptCapability = Schema.Literals(["image", "audio", "embeddedContext"]);
export type PromptCapability = Schema.Schema.Type<typeof PromptCapability>;

export class PromptError extends Schema.TaggedError<PromptError>(
  "open-insight/AcpError/PromptError",
)("PromptError", {
  reason: PromptErrorReason,
  partIndex: Schema.Number,
  partType: Schema.Literals(["text", "file"]),
  mediaType: Schema.optionalKey(Schema.String),
  capability: Schema.optionalKey(PromptCapability),
}) {
  override get message(): string {
    switch (this.reason) {
      case "capability_not_enabled":
        return `ACP prompt part ${this.partIndex} requires the ${this.capability ?? "requested"} capability`;
      case "invalid_base64":
        return `ACP prompt part ${this.partIndex} contains invalid base64 data`;
      case "invalid_data_url":
        return `ACP prompt part ${this.partIndex} contains an invalid data URL`;
      case "data_url_media_type_mismatch":
        return `ACP prompt part ${this.partIndex} has a data URL media type mismatch`;
    }
  }
}

export const HttpTransportOperation = Schema.Literals([
  "parse-url",
  "connect",
  "request",
  "response",
]);
export type HttpTransportOperation = Schema.Schema.Type<typeof HttpTransportOperation>;

export class HttpTransportError extends Schema.TaggedError<HttpTransportError>(
  "open-insight/AcpError/HttpTransportError",
)("HttpTransportError", {
  url: Schema.String,
  operation: HttpTransportOperation,
  status: Schema.optionalKey(Schema.Number),
  detail: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    const status = this.status === undefined ? "" : ` with HTTP status ${this.status}`;
    const detail =
      this.detail ?? (this.cause === undefined ? undefined : Formatter.format(this.cause));
    return `ACP HTTP transport ${this.operation} failed for ${this.url}${status}${detail === undefined ? "" : `: ${detail}`}`;
  }
}

export const AuthenticationErrorReason = Schema.Literals([
  "authentication_required",
  "unsupported_method",
  "authentication_failed",
]);
export type AuthenticationErrorReason = Schema.Schema.Type<typeof AuthenticationErrorReason>;

export class AuthenticationError extends Schema.TaggedError<AuthenticationError>(
  "open-insight/AcpError/AuthenticationError",
)("AuthenticationError", {
  reason: AuthenticationErrorReason,
  methodId: Schema.optionalKey(Schema.String),
  availableMethodIds: Schema.Array(Schema.String),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    const available = this.availableMethodIds.join(", ");
    switch (this.reason) {
      case "authentication_required":
        return available.length === 0
          ? "ACP agent requires authentication"
          : `ACP agent requires authentication; configure auth with one of: ${available}`;
      case "unsupported_method":
        return `ACP authentication method ${this.methodId} is not supported; available methods: ${available}`;
      case "authentication_failed":
        return `ACP authentication failed for method ${this.methodId}`;
    }
  }
}

export const ErrorReason = Schema.Union([PromptError, HttpTransportError, AuthenticationError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class AcpError extends Schema.TaggedError<AcpError>("open-insight/AcpError")("AcpError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static prompt = (reason: PromptError): AcpError => AcpError.make({ reason });

  static http =
    (url: string, operation: HttpTransportOperation, status?: number) =>
    (cause: unknown): AcpError =>
      AcpError.make({
        reason: HttpTransportError.make({
          url,
          operation,
          cause,
          ...(status === undefined ? {} : { status }),
        }),
      });

  static httpResponse = (url: string, status: number, detail: string): AcpError =>
    AcpError.make({
      reason: HttpTransportError.make({ url, operation: "response", status, detail }),
    });

  static authenticationRequired = (
    availableMethodIds: ReadonlyArray<string>,
    cause?: unknown,
  ): AcpError =>
    AcpError.make({
      reason: AuthenticationError.make({
        reason: "authentication_required",
        availableMethodIds: [...availableMethodIds],
        ...(cause === undefined ? {} : { cause }),
      }),
    });

  static unsupportedAuthenticationMethod = (
    methodId: string,
    availableMethodIds: ReadonlyArray<string>,
  ): AcpError =>
    AcpError.make({
      reason: AuthenticationError.make({
        reason: "unsupported_method",
        methodId,
        availableMethodIds: [...availableMethodIds],
      }),
    });

  static authenticationFailed =
    (methodId: string) =>
    (cause: unknown): AcpError =>
      AcpError.make({
        reason: AuthenticationError.make({
          reason: "authentication_failed",
          methodId,
          availableMethodIds: [],
          cause,
        }),
      });
}

const agentError = (cause: unknown): Agent.AgentError => Agent.AgentError.make({ cause });

const DEFAULT_CWD = "/workspace";
const DEFAULT_PORT = 7689;
const DEFAULT_PATH = "/acp";
const AUTH_REQUIRED_CODE = -32_000;

const unsupportedCapabilities = {
  fs: {
    readTextFile: false,
    writeTextFile: false,
  },
  terminal: false,
  session: null,
  plan: null,
  auth: {
    terminal: false,
  },
  elicitation: null,
  nes: null,
  positionEncodings: [],
} satisfies ClientCapabilities;

export interface Options extends HttpStreamOptions, WebSocketStreamOptions {
  readonly auth?: AuthenticateRequest;
  readonly agentArgs?: ReadonlyArray<string>;
  readonly serveEnv?: Readonly<Record<string, string>>;
  readonly disableYolo?: boolean;
  readonly port?: number;
  readonly path?: string;
  readonly cwd?: string;
  readonly additionalDirectories?: ReadonlyArray<string>;
  readonly mcpServers?: ReadonlyArray<McpServer>;
  readonly clientInfo?: Implementation;
}

type StartTurn = (effect: Effect.Effect<void>) => void;

type SessionContext = Readonly<{
  session: ActiveSession;
  promptCapabilities: PromptCapabilities | undefined;
  startTurn: StartTurn;
  cancellingSessions: Set<string>;
  notifyCancel: () => Promise<void>;
  turnActive: Ref.Ref<boolean>;
}>;

const protocolEffect = <A>(evaluate: () => Promise<A>): Effect.Effect<A, Agent.AgentError> =>
  Effect.tryPromise({
    try: evaluate,
    catch: agentError,
  });

const validateAbsolutePath = (
  pathService: Path.Path,
  label: string,
  path: string,
): Effect.Effect<void, Agent.AgentError> =>
  pathService.isAbsolute(path)
    ? Effect.void
    : Effect.fail(agentError(new TypeError(`${label} must be an absolute path: ${path}`)));

const validateOptions = Effect.fn("Acp.validateOptions")(function* (
  agentId: string,
  options: Options,
) {
  const path = yield* Path.Path;
  if (agentId.trim().length === 0) {
    return yield* Effect.fail(agentError(new TypeError("ACP agentId must not be empty")));
  }
  const port = options.port ?? DEFAULT_PORT;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return yield* Effect.fail(
      agentError(new RangeError(`ACP agent port must be between 1 and 65535: ${port}`)),
    );
  }
  const endpointPath = options.path ?? DEFAULT_PATH;
  if (!endpointPath.startsWith("/") || endpointPath === "/" || endpointPath === "/health") {
    return yield* Effect.fail(
      agentError(new TypeError(`Invalid ACP agent endpoint path: ${endpointPath}`)),
    );
  }
  yield* validateAbsolutePath(path, "ACP session cwd", options.cwd ?? DEFAULT_CWD);
  yield* Effect.forEach(options.additionalDirectories ?? [], (directory, index) =>
    validateAbsolutePath(path, `ACP additional directory ${index}`, directory),
  );
  for (const [name, value] of Object.entries(options.serveEnv ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return yield* Effect.fail(
        agentError(new TypeError(`Invalid ACP serve environment variable name: ${name}`)),
      );
    }
    if (typeof value !== "string") {
      return yield* Effect.fail(
        agentError(
          new TypeError(`ACP serve environment variable ${name} must have a string value`),
        ),
      );
    }
  }
});

const snapshotExtension = (agentId: string, options: Options): Agent.SnapshotExtension => {
  const serveEnv = options.serveEnv;

  return {
    instructions: [
      Snapshot.Instruction.copy(["/deno"], "/usr/local/bin/deno", {
        from: "ghcr.io/denoland/deno:bin",
      }),
      Snapshot.Instruction.available("deno"),
      Snapshot.Instruction.copy(["/uv", "/uvx"], "/usr/local/bin/", {
        from: "ghcr.io/astral-sh/uv:latest",
      }),
      Snapshot.Instruction.available("uv"),
      Snapshot.Instruction.copy(["/acp-agent"], "/usr/local/bin/acp-agent", {
        from: "ghcr.io/openinsightdev/acp-agent:bin",
      }),
      Snapshot.Instruction.available("acp-agent"),
      Snapshot.Instruction.run(`acp-agent install ${Bash.quote(agentId)}`),
      ...(serveEnv === undefined || Object.keys(serveEnv).length === 0
        ? []
        : [Snapshot.Instruction.env({ ...serveEnv })]),
    ],
  };
};

const userMessage = (
  trajectory: Prompt.Prompt,
): Effect.Effect<Prompt.UserMessage, Agent.AgentError> => {
  const message = trajectory.content[trajectory.content.length - 1];
  return message?.role === "user"
    ? Effect.succeed(message)
    : Effect.fail(agentError(new TypeError("The last ACP session message must be a user message")));
};

const cancelTurn = (
  sessionId: string,
  notify: () => Promise<void>,
  cancellingSessions: Set<string>,
) =>
  Effect.sync(() => cancellingSessions.add(sessionId)).pipe(
    Effect.andThen(protocolEffect(notify).pipe(Effect.ignore)),
  );

const cancelActiveTurn = (context: SessionContext) =>
  cancelTurn(context.session.sessionId, context.notifyCancel, context.cancellingSessions);

const sessionUpdateStream = (
  context: SessionContext,
  prompt: Array<ContentBlock>,
): Stream.Stream<SessionUpdate, Agent.AgentError> =>
  Effect.gen(function* () {
    const wasActive = yield* Ref.getAndSet(context.turnActive, true);
    if (wasActive) {
      return yield* Effect.fail(
        agentError(
          new globalThis.Error(
            `ACP session ${context.session.sessionId} already has an active prompt`,
          ),
        ),
      );
    }

    const queue = yield* Queue.unbounded<SessionUpdate, Agent.AgentError | Cause.Done>();
    const clearTurn = Ref.set(context.turnActive, false).pipe(
      Effect.andThen(
        Effect.sync(() => {
          context.cancellingSessions.delete(context.session.sessionId);
        }),
      ),
    );
    const pump = Effect.gen(function* () {
      yield* protocolEffect(() => context.session.prompt(prompt)).pipe(
        Effect.ignore,
        Effect.forkChild,
      );

      let stopped = false;
      while (!stopped) {
        const message = yield* protocolEffect(() => context.session.nextUpdate());
        if (message.kind === "stop") {
          stopped = true;
        } else {
          yield* Queue.offer(queue, message.update);
        }
      }
    });
    const producer = pump.pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          clearTurn.pipe(Effect.andThen(Queue.failCause(queue, cause)), Effect.asVoid),
        onSuccess: () => clearTurn.pipe(Effect.andThen(Queue.end(queue)), Effect.asVoid),
      }),
    );

    yield* Effect.sync(() => context.startTurn(producer));

    return Stream.fromQueue(queue).pipe(
      Stream.ensuring(
        Ref.get(context.turnActive).pipe(
          Effect.flatMap((active) => (active ? cancelActiveTurn(context) : Effect.void)),
        ),
      ),
    );
  }).pipe(Stream.unwrap);

const promptStream = (
  context: SessionContext,
  trajectory: Prompt.Prompt,
): Stream.Stream<Response.StreamPartView<{}>, Agent.AgentError> =>
  Effect.gen(function* () {
    const message = yield* userMessage(trajectory);
    const prompt = yield* toAcpPrompt(message, {
      promptCapabilities: context.promptCapabilities,
    }).pipe(Effect.mapError(agentError));
    return sessionUpdateStream(context, prompt).pipe(transform);
  }).pipe(Stream.unwrap);

const authMethodIds = (initialized: InitializeResponse) =>
  initialized.authMethods?.map((method) => method.id) ?? [];

const authenticate = Effect.fn("Acp.authenticate")(function* (
  request: (params: AuthenticateRequest) => Promise<unknown>,
  initialized: InitializeResponse,
  auth: AuthenticateRequest | undefined,
) {
  if (auth === undefined) {
    return;
  }
  const availableMethodIds = authMethodIds(initialized);
  if (!availableMethodIds.includes(auth.methodId)) {
    return yield* Effect.fail(
      AcpError.unsupportedAuthenticationMethod(auth.methodId, availableMethodIds),
    );
  }
  yield* Effect.tryPromise({
    try: () => request(auth),
    catch: (cause) =>
      cause instanceof AcpError ? cause : AcpError.authenticationFailed(auth.methodId)(cause),
  }).pipe(Effect.asVoid);
});

const sessionStartError =
  (initialized: InitializeResponse) =>
  (cause: unknown): Agent.AgentError => {
    if (cause instanceof RequestError && cause.code === AUTH_REQUIRED_CODE) {
      return agentError(AcpError.authenticationRequired(authMethodIds(initialized), cause));
    }
    return Agent.AgentError.make({ cause: cause });
  };

const agentReady = (url: URL, options: Options): Effect.Effect<boolean, Agent.AgentError> =>
  Effect.tryPromise({
    try: async () => {
      const healthUrl = new URL("/health", url);
      const response = await (options.fetch ?? globalThis.fetch)(healthUrl);
      if (!response.ok) {
        throw new globalThis.Error(`ACP agent not ready: ${response.status}`);
      }
      return true;
    },
    catch: agentError,
  });

export const waitForAgentReady = Effect.fn(function* (url: URL, options: Options) {
  yield* agentReady(url, options).pipe(
    Effect.retry(Schedule.fixed("500 millis").pipe(Schedule.upTo({ duration: "1 minute" }))),
  );
});

export const makeProvider = Effect.fn("Acp.makeProvider")(function* (
  agentId: string,
  options: Options,
): Effect.fn.Return<Agent.Provider, Agent.AgentError, Path.Path> {
  yield* validateOptions(agentId, options);

  const runSession = Effect.fn("Acp.runSession")(function* () {
    const port = options.port ?? DEFAULT_PORT;
    const path = options.path ?? DEFAULT_PATH;

    const sandbox = yield* Sandbox.Sandbox;

    const hostUrl = yield* sandbox.network
      .expose({ sandboxPort: port })
      .pipe(Effect.mapError(agentError));

    const url = yield* Effect.try({
      try: () => new URL(path, hostUrl),
      catch: agentError,
    });
    yield* waitForAgentReady(url, options);
    const transport = yield* openStream(url, options).pipe(Effect.mapError(agentError));

    const runTurn = yield* FiberSet.makeRuntime<never, void, never>();
    const startTurn: StartTurn = (effect) => {
      runTurn(effect);
    };
    const cancellingSessions = new Set<string>();
    const app = client({ name: "open-insight" }).onRequest(
      methods.client.session.requestPermission,
      ({ params }) => {
        if (cancellingSessions.has(params.sessionId)) {
          return { outcome: { outcome: "cancelled" } };
        }
        throw RequestError.methodNotFound(methods.client.session.requestPermission);
      },
    );
    const connection = app.connect(transport);
    yield* Effect.addFinalizer(() => Effect.sync(() => connection.close()));

    const initialized = yield* protocolEffect<InitializeResponse>(() =>
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: unsupportedCapabilities,
        ...(options.clientInfo === undefined ? {} : { clientInfo: options.clientInfo }),
      }),
    );
    if (initialized.protocolVersion !== PROTOCOL_VERSION) {
      return yield* Effect.fail(
        agentError(
          new globalThis.Error(
            `ACP agent selected unsupported protocol version ${initialized.protocolVersion}`,
          ),
        ),
      );
    }
    yield* authenticate(
      (params) => connection.agent.request(methods.agent.authenticate, params),
      initialized,
      options.auth,
    ).pipe(Effect.mapError(agentError));

    const session = yield* Effect.tryPromise({
      try: () =>
        connection.agent
          .buildSession({
            cwd: options.cwd ?? DEFAULT_CWD,
            additionalDirectories: [...(options.additionalDirectories ?? [])],
            mcpServers: [...(options.mcpServers ?? [])],
          })
          .start(),
      catch: sessionStartError(initialized),
    });

    const turnActive = yield* Ref.make(false);
    const context: SessionContext = {
      session,
      promptCapabilities: initialized.agentCapabilities?.promptCapabilities,
      startTurn,
      cancellingSessions,
      notifyCancel: () =>
        connection.agent.notify(methods.agent.session.cancel, {
          sessionId: session.sessionId,
        }),
      turnActive,
    };

    return {
      prompt: (prompt: Prompt.Prompt) => promptStream(context, prompt),
    };
  });

  return Agent.make({
    snapshotExtension: snapshotExtension(agentId, options),
    runSession,
  });
});

export const layerFrom = (agentID: string, options: Options) =>
  Layer.effect(Agent.ProviderService, makeProvider(agentID, options));

type SegmentKind = "text" | "reasoning";

type AgentChunkUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" }
>;

type UsageUpdate = Extract<SessionUpdate, { sessionUpdate: "usage_update" }>;

type HarnessState = Readonly<{
  active: Readonly<Record<SegmentKind, string | undefined>>;
  fallbackIndexes: Readonly<Record<SegmentKind, number>>;
  toolNames: ReadonlyMap<string, string>;
  usage: UsageUpdate | undefined;
}>;

const initialHarnessState = (): HarnessState => ({
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

const harnessMetadataPart = (metadata: Response.ProviderMetadata): Response.ResponseMetadataPart =>
  Response.makePart("response-metadata", { metadata });

const harnessFinishPart = (update: UsageUpdate | undefined): Response.FinishPart =>
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
    ? [harnessMetadataPart(metadata)]
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
        : [harnessMetadataPart(metadata)];
    case "resource_link":
    case "text":
      return [harnessMetadataPart(metadata)];
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
  state: HarnessState,
  update: AgentChunkUpdate,
  kind: SegmentKind,
): readonly [HarnessState, string] => {
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

const setActiveSegment = (state: HarnessState, kind: SegmentKind, id: string | undefined): HarnessState => ({
  ...state,
  active: {
    ...state.active,
    [kind]: id,
  },
});

const closeSegment = (
  state: HarnessState,
  kind: SegmentKind,
  metadata: Response.ProviderMetadata,
): readonly [HarnessState, ReadonlyArray<StreamPart>] => {
  const activeId = state.active[kind];
  if (activeId === undefined) {
    return [state, []];
  }

  return [setActiveSegment(state, kind, undefined), [segmentEndPart(kind, activeId, metadata)]];
};

const handleAgentChunk = (
  state: HarnessState,
  update: AgentChunkUpdate,
  metadata: Response.ProviderMetadata,
): readonly [HarnessState, ReadonlyArray<StreamPart>] => {
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
  state: HarnessState,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call" }>,
  metadata: Response.ProviderMetadata,
): readonly [HarnessState, ReadonlyArray<StreamPart>] => {
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
  state: HarnessState,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
  metadata: Response.ProviderMetadata,
): readonly [HarnessState, ReadonlyArray<StreamPart>] => {
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

const handleHarnessUpdate = (
  state: HarnessState,
  update: SessionUpdate,
): readonly [HarnessState, ReadonlyArray<StreamPart>] => {
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
      return [state, [harnessMetadataPart(metadata)]];
    default:
      return [state, [harnessMetadataPart(metadata)]];
  }
};

const closeStream = (state: HarnessState): ReadonlyArray<StreamPart> => {
  const [stateWithoutText, textParts] = closeSegment(state, "text", streamCompleteMetadata);
  const [_closedState, reasoningParts] = closeSegment(
    stateWithoutText,
    "reasoning",
    streamCompleteMetadata,
  );
  return [...textParts, ...reasoningParts, harnessFinishPart(state.usage)];
};

const handleStreamEvent = (
  state: HarnessState,
  event: SessionUpdate | typeof streamEnd,
): readonly [HarnessState, ReadonlyArray<StreamPart>] =>
  event === streamEnd ? [state, closeStream(state)] : handleHarnessUpdate(state, event);

export const transform = <E, R>(
  stream: Stream.Stream<SessionUpdate, E, R>,
): Stream.Stream<StreamPart, E, R> =>
  stream.pipe(
    Stream.concat(Stream.succeed(streamEnd)),
    Stream.mapAccum(initialHarnessState, handleStreamEvent),
  );
