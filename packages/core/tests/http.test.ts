import { PROTOCOL_VERSION, type AnyMessage } from "@agentclientprotocol/sdk";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { AcpError } from "#/AcpError.ts";
import { openHttpStream, openStream, openWebSocketStream } from "#/internal/acp-http.ts";

const initializeRequest = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
  },
} satisfies AnyMessage;

const transportError = (error: AcpError) => {
  assert.strictEqual(error.reason._tag, "HttpTransportError");
  if (error.reason._tag !== "HttpTransportError") {
    assert.fail(`Expected HttpTransportError, received ${error.reason._tag}`);
  }
  return error.reason;
};

it.effect("rejects invalid URLs before opening a connection", () =>
  Effect.gen(function* () {
    const error = yield* openHttpStream("not a url").pipe(Effect.flip);
    const reason = transportError(error);

    assert.strictEqual(reason.operation, "parse-url");
    assert.strictEqual(reason.url, "not a url");
  }),
);

it.effect("rejects transport URLs with an incompatible scheme before connecting", () =>
  Effect.gen(function* () {
    const httpError = yield* openHttpStream("ws://agent.test/acp").pipe(Effect.flip);
    const webSocketError = yield* openWebSocketStream("https://agent.test/acp").pipe(Effect.flip);
    const autoError = yield* openStream("ftp://agent.test/acp").pipe(Effect.flip);

    for (const error of [httpError, webSocketError, autoError]) {
      assert.strictEqual(transportError(error).operation, "parse-url");
    }
  }),
);

it("preserves non-Error transport causes in typed ACP errors", () => {
  const error = AcpError.http("http://agent.test/", "request")("stopped");
  const reason = transportError(error);

  assert.strictEqual(reason.cause, "stopped");
  assert.include(reason.message, "stopped");
});

it.effect("uses Streamable HTTP JSON, SSE, and DELETE with supplied headers", () =>
  Effect.gen(function* () {
    const requests: Array<Request> = [];
    let notifyDeleted: () => void = () => undefined;
    const deleted = new Promise<void>((resolve) => {
      notifyDeleted = resolve;
    });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);

      switch (request.method) {
        case "POST":
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 0,
              result: { protocolVersion: PROTOCOL_VERSION },
            } satisfies AnyMessage),
            {
              status: 200,
              headers: {
                "acp-connection-id": "connection-1",
                "content-type": "application/json",
              },
            },
          );
        case "GET":
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                init?.signal?.addEventListener("abort", () => controller.close(), { once: true });
              },
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        case "DELETE":
          notifyDeleted();
          return new Response(null, { status: 204 });
        default:
          return new Response("unsupported request", { status: 405 });
      }
    };

    yield* Effect.scoped(
      Effect.gen(function* () {
        const stream = yield* openHttpStream("http://agent.test/acp?transport=http", {
          fetch,
          headers: { authorization: "Bearer test-token" },
        });
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();

        yield* Effect.promise(() => writer.write(initializeRequest));
        const response = yield* Effect.promise(() => reader.read());
        assert.isFalse(response.done);
        assert.deepStrictEqual(response.value, {
          jsonrpc: "2.0",
          id: 0,
          result: { protocolVersion: PROTOCOL_VERSION },
        });
        writer.releaseLock();
        reader.releaseLock();
      }),
    );

    yield* Effect.promise(() => deleted);
    const post = requests.find((request) => request.method === "POST");
    const sse = requests.find((request) => request.method === "GET");
    const close = requests.find((request) => request.method === "DELETE");
    if (post === undefined || sse === undefined || close === undefined) {
      assert.fail("Streamable HTTP must issue POST, SSE GET, and DELETE requests");
      return;
    }

    assert.strictEqual(post.url, "http://agent.test/acp?transport=http");
    assert.strictEqual(post.headers.get("content-type"), "application/json");
    assert.strictEqual(post.headers.get("authorization"), "Bearer test-token");
    assert.strictEqual(sse.headers.get("accept"), "text/event-stream");
    assert.strictEqual(sse.headers.get("authorization"), "Bearer test-token");
    assert.strictEqual(close.headers.get("acp-connection-id"), "connection-1");
  }),
);

it.effect("surfaces Streamable HTTP response failures as typed transport errors", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fetch: typeof globalThis.fetch = async () =>
        new Response("only application/json is supported", {
          status: 415,
          statusText: "Unsupported Media Type",
        });
      const stream = yield* openHttpStream("http://agent.test/acp", { fetch });
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      const mapResponseError = (cause: unknown) =>
        cause instanceof AcpError
          ? cause
          : AcpError.http("http://agent.test/acp", "response")(cause);
      const error = yield* Effect.tryPromise({
        try: () => writer.write(initializeRequest),
        catch: mapResponseError,
      }).pipe(Effect.flip);
      const readError = yield* Effect.tryPromise({
        try: () => reader.read(),
        catch: mapResponseError,
      }).pipe(Effect.flip);
      writer.releaseLock();
      reader.releaseLock();
      const reason = transportError(error);

      assert.strictEqual(reason.operation, "response");
      assert.strictEqual(reason.status, 415);
      assert.include(reason.message, "only application/json is supported");
      assert.strictEqual(readError, error);
    }),
  ),
);

class TestWebSocket {
  static latest: TestWebSocket | undefined;

  readonly sent: Array<string> = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  closed = false;

  constructor(
    readonly url: string,
    readonly protocols?: string | Array<string>,
    readonly options?: { readonly headers?: Record<string, string> },
  ) {
    TestWebSocket.latest = this;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    for (const listener of this.listeners.get("close") ?? []) {
      listener({});
    }
  }
}

it.effect("uses the WebSocket SDK transport with text frames and closes it on scope exit", () =>
  Effect.gen(function* () {
    TestWebSocket.latest = undefined;
    let socket: TestWebSocket | undefined;

    yield* Effect.scoped(
      Effect.gen(function* () {
        const stream = yield* openWebSocketStream("ws://agent.test/acp", {
          WebSocket: TestWebSocket,
          headers: { authorization: "Bearer test-token" },
        });
        socket = TestWebSocket.latest;
        if (socket === undefined) {
          assert.fail("WebSocket transport did not create a socket");
          return;
        }
        const writer = stream.writable.getWriter();
        yield* Effect.promise(() => writer.write(initializeRequest));
        writer.releaseLock();

        assert.strictEqual(socket.url, "ws://agent.test/acp");
        assert.strictEqual(socket.options?.headers?.authorization, "Bearer test-token");
        assert.deepStrictEqual(JSON.parse(socket.sent[0] ?? ""), initializeRequest);
      }),
    );

    if (socket === undefined) {
      assert.fail("WebSocket transport did not retain its socket");
      return;
    }
    assert.isTrue(socket.closed);
  }),
);
