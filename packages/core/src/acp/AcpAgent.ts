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
} from "@agentclientprotocol/sdk";
import { Cause, Effect, FiberSet, Layer, Path, Queue, Ref, Schedule, Stream } from "effect";
import * as Agent from "#/agent/Agent.ts";
import * as Prompt from "#/prompt/index.ts";
import * as Response from "#/response/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import * as Bash from "#/utils/Shell.ts";
import { AcpError } from "./AcpError.ts";
import { transform } from "./AcpHarness.ts";
import {
  type HttpStreamOptions,
  openStream,
  type WebSocketStreamOptions,
} from "./internal/http.ts";
import { toAcpPrompt } from "./internal/prompt.ts";

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
  /**
   * Authentication request to send when the agent advertises authentication
   * methods during initialization.
   * Credentials remain agent-managed per ACP.
   */
  readonly auth?: AuthenticateRequest;
  readonly agentArgs?: ReadonlyArray<string>;
  /**
   * Environment variables baked into the generated snapshot and inherited by `acp-agent serve` and the agent process it starts.
   * Use this for the selected agent's runtime configuration, such as `DEFAULT_AUTH_REQUEST`
   * or `CODEX_CONFIG`.
   *
   * Values become part of the derived snapshot image.
   * Do not use this for credentials unless that image is kept private.
   */
  readonly serveEnv?: Readonly<Record<string, string>>;
  /**
   * Activates the agent's yolo/auto-approve mode by passing `--yolo` to `acp-agent serve`, which injects the agent's mapped startup flag from the published yolo-mode catalog.
   * Enabled by default; set `disableYolo` to `true` to opt out.
   */
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
  const port = String(options.port ?? DEFAULT_PORT);
  const path = options.path ?? DEFAULT_PATH;
  const serveArgs = [
    agentId,
    "--host",
    "0.0.0.0",
    "--port",
    port,
    "--path",
    path,
    ...(options.disableYolo === true ? [] : ["--yolo"]),
    ...(options.agentArgs === undefined ? [] : ["--", ...options.agentArgs]),
  ];
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

// The agent server process inside the sandbox binds its listener a moment
// after the container starts. Poll its liveness endpoint until it accepts
// connections so the first transport request is not sent into a closed socket.
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
