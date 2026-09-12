import { Context, Effect, Layer, Option, Schema, Sink, Stream, type Types } from "effect";
import picomatch from "picomatch";
import { operationFailed, type SandboxError } from "./SandboxError.ts";
import type * as WebDAV from "webdav-client";

/** Metadata that can be represented by WebDAV properties. */
export interface ResourceInfo {
  /** `Directory` represents a WebDAV collection; other resources are `File`. */
  readonly type: "File" | "Directory";
  readonly size?: bigint;
  readonly etag?: string;
  readonly lastModified?: Date;
  readonly creationDate?: Date;
  readonly contentType?: string;
}

/**
 * Represent a remote file system in a sandbox.
 */
export class FileSystem extends Context.Service<
  FileSystem,
  {
    /**
     * Checks whether a path can be accessed.
     *
     * **Details**
     *
     * WebDAV only reports whether the resource is visible to the authenticated
     * user; POSIX read/write/execute bits cannot be queried.
     */
    readonly access: (path: string) => Effect.Effect<void, SandboxError>;

    /**
     * Copy a file or directory from `fromPath` to `toPath`.
     *
     * **Details**
     *
     * Equivalent to `cp -r`.
     */
    readonly copy: (
      fromPath: string,
      toPath: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Copy a file from `fromPath` to `toPath`.
     *
     * **Details**
     *
     * Members of a directory are not copied.
     */
    readonly copyFile: (
      fromPath: string,
      toPath: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Glob a directory.
     *
     * **Details**
     *
     * WebDAV has no server-side glob, so the tree below `root` (the WebDAV root
     * by default) is listed and matched locally. The returned paths, and the
     * paths `pattern` and `exclude` are matched against, are relative to `root`.
     */
    readonly glob: (
      pattern: string,
      options?: {
        readonly root?: string;
        readonly exclude?: ReadonlyArray<string>;
      },
    ) => Effect.Effect<ReadonlyArray<string>, SandboxError>;

    /**
     * Checks whether a path exists.
     */
    readonly exists: (path: string) => Effect.Effect<boolean, SandboxError>;

    /**
     * Create a directory at `path`. You can optionally specify whether to recursively create nested directories.
     *
     * **Details**
     *
     * `MKCOL` never creates intermediate collections, so `recursive` sends one
     * request per path segment. Creating a directory that already exists is not
     * an error.
     */
    readonly makeDirectory: (
      path: string,
      options?: { readonly recursive?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * List the contents of a directory.
     *
     * **Details**
     *
     * Returns entry names relative to `path`. You can recursively list the
     * contents of nested directories by setting the `recursive` option, which
     * walks the tree with one request per directory because servers are only
     * required to support `Depth: 0` and `Depth: 1`.
     */
    readonly readDirectory: (
      path: string,
      options?: { readonly recursive?: boolean },
    ) => Effect.Effect<ReadonlyArray<string>, SandboxError>;

    /**
     * Read the contents of a file.
     */
    readonly readFile: (path: string) => Effect.Effect<Uint8Array, SandboxError>;

    /**
     * Read the contents of a file and decode it with `encoding`, which defaults
     * to `utf-8`.
     */
    readonly readFileString: (
      path: string,
      encoding?: string,
    ) => Effect.Effect<string, SandboxError>;

    /**
     * Remove a file or directory.
     *
     * **Details**
     *
     * Equivalent to `rm -rf`: `DELETE` always removes a directory together with
     * its members, and removing a path that does not exist succeeds.
     */
    readonly remove: (path: string) => Effect.Effect<void, SandboxError>;

    /**
     * Rename a file or directory.
     */
    readonly rename: (
      oldPath: string,
      newPath: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Create a writable `Sink` for the specified `path`.
     *
     * **Details**
     *
     * WebDAV can only replace a resource as a whole, so the sink buffers the
     * incoming chunks and writes them with a single `PUT` once the stream ends.
     */
    readonly sink: (path: string) => Sink.Sink<void, Uint8Array, never, SandboxError>;

    /**
     * Get information about a file at `path`.
     */
    readonly stat: (path: string) => Effect.Effect<ResourceInfo, SandboxError>;

    /**
     * Create a readable `Stream` for the specified `path`.
     *
     * **Details**
     *
     * `offset` and `bytesToRead` are requested with an HTTP `Range` header, so
     * the server has to support ranged reads. The size of the emitted chunks is
     * decided by the transport.
     */
    readonly stream: (
      path: string,
      options?: {
        readonly bytesToRead?: bigint;
        readonly offset?: bigint;
      },
    ) => Stream.Stream<Uint8Array, SandboxError>;

    /**
     * Write data to a file at `path`.
     *
     * **Details**
     *
     * Fails when `overwrite` is `false` and the file already exists.
     */
    readonly writeFile: (
      path: string,
      data: Uint8Array,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Write a string to a file at `path`, encoded as UTF-8.
     */
    readonly writeFileString: (
      path: string,
      data: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;
  }
>()("@open-insight/agent/fs/FileSystem") {}

export type WebDAVOptions = Readonly<{
  /**
   * A WebDAV client. Its `Auth` and `Transport` services are taken from the
   * context the layer is built in.
   */
  readonly client: WebDAV.Client;
}>;

/** Decode a WebDAV date property; servers omit or malform them freely. */
const decodeDate = Schema.decodeUnknownOption(Schema.DateFromString);

const toResourceInfo = (info: WebDAV.FileStat): ResourceInfo => {
  const resource: Types.Mutable<ResourceInfo> = {
    type: info.type === "directory" ? "Directory" : "File",
  };
  if (info.type === "file") {
    resource.size = BigInt(info.size);
  }
  if (info.etag !== null) {
    resource.etag = info.etag;
  }
  if (info.mime !== undefined) {
    resource.contentType = info.mime;
  }
  const lastModified = decodeDate(info.lastmod);
  if (Option.isSome(lastModified)) {
    resource.lastModified = lastModified.value;
  }
  const creationDate = decodeDate(info.props?.creationdate);
  if (Option.isSome(creationDate)) {
    resource.creationDate = creationDate.value;
  }
  return resource;
};

/** A directory path with exactly one leading and one trailing slash. */
const directoryPrefix = (path: string): string => {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
};

const childPath = (path: string, name: string): string => `${directoryPrefix(path)}${name}`;

const concatChunks = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const data = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
};

/**
 * Translate an offset and a length into the inclusive byte range of a `Range`
 * header, or `undefined` when the whole resource is requested.
 */
const toRange = (options?: {
  readonly bytesToRead?: bigint;
  readonly offset?: bigint;
}): WebDAV.Range | undefined => {
  if (options?.offset === undefined && options?.bytesToRead === undefined) {
    return undefined;
  }
  const start = Number(options.offset ?? 0n);
  if (options.bytesToRead === undefined) return { start };
  return { start, end: start + Number(options.bytesToRead) - 1 };
};

const make = Effect.fn(function* (client: WebDAV.Client) {
  const context = yield* Effect.context<WebDAV.OperationRequirements>();

  /** Run a WebDAV request with the client's services and report failures as `SandboxError`. */
  const request = <A>(
    operation: string,
    path: string,
    effect: Effect.Effect<A, WebDAV.OperationError, WebDAV.OperationRequirements>,
  ): Effect.Effect<A, SandboxError> =>
    effect.pipe(Effect.provideContext(context), Effect.mapError(operationFailed(operation, path)));

  /** `PUT` the whole resource, failing when the server refused to replace it. */
  const put = (
    operation: string,
    path: string,
    data: WebDAV.UploadData,
    options?: { readonly overwrite?: boolean },
  ): Effect.Effect<void, SandboxError> =>
    request(operation, path, client.putFileContents(path, data, { ...options })).pipe(
      Effect.flatMap((written) =>
        written
          ? Effect.void
          : Effect.fail(operationFailed(operation, path)(new Error(`"${path}" already exists`))),
      ),
    );

  const entries = (
    operation: string,
    path: string,
  ): Effect.Effect<ReadonlyArray<WebDAV.FileStat>, SandboxError> =>
    request(operation, path, client.getDirectoryContents(path));

  /** List the tree below `path`, returning directory and file names relative to it. */
  const walk = (operation: string, path: string): Effect.Effect<Array<string>, SandboxError> =>
    entries(operation, path).pipe(
      Effect.flatMap((items) =>
        Effect.forEach(items, (item) =>
          item.type === "file"
            ? Effect.succeed([item.basename])
            : walk(operation, childPath(path, item.basename)).pipe(
                Effect.map((nested) => [
                  item.basename,
                  ...nested.map((name) => `${item.basename}/${name}`),
                ]),
              ),
        ),
      ),
      Effect.map((names) => names.flat()),
    );

  const readStream = (
    operation: string,
    path: string,
    options?: { readonly bytesToRead?: bigint; readonly offset?: bigint },
  ): Stream.Stream<Uint8Array, SandboxError> => {
    const range = toRange(options);
    return request(
      operation,
      path,
      client.createReadStream(path, range === undefined ? {} : { range }),
    ).pipe(
      Effect.map(Stream.mapError((cause) => operationFailed(operation, path)(cause))),
      Stream.unwrap,
    );
  };

  const readBytes = (operation: string, path: string): Effect.Effect<Uint8Array, SandboxError> =>
    Stream.runCollect(readStream(operation, path)).pipe(Effect.map(concatChunks));

  return FileSystem.of({
    access: (path) => request("access", path, client.stat(path)).pipe(Effect.asVoid),

    copy: (fromPath, toPath, options) =>
      request("copy", fromPath, client.copyFile(fromPath, toPath, { ...options, shallow: false })),

    copyFile: (fromPath, toPath, options) =>
      request(
        "copyFile",
        fromPath,
        client.copyFile(fromPath, toPath, { ...options, shallow: true }),
      ),

    glob: (pattern, options) => {
      const included = picomatch(pattern);
      const excluded =
        options?.exclude === undefined ? () => false : picomatch([...options.exclude]);
      return walk("glob", options?.root ?? "/").pipe(
        Effect.map((paths) => paths.filter((path) => included(path) && !excluded(path))),
      );
    },

    exists: (path) => request("exists", path, client.exists(path)),

    makeDirectory: (path, options) =>
      request("makeDirectory", path, client.createDirectory(path, { ...options })),

    readDirectory: (path, options) =>
      options?.recursive === true
        ? walk("readDirectory", path)
        : entries("readDirectory", path).pipe(
            Effect.map((items) => items.map((item) => item.basename)),
          ),

    readFile: (path) => readBytes("readFile", path),

    readFileString: (path, encoding = "utf-8") =>
      readBytes("readFileString", path).pipe(
        Effect.flatMap((data) =>
          Effect.try({
            try: () => new TextDecoder(encoding).decode(data),
            catch: operationFailed("readFileString", path),
          }),
        ),
      ),

    remove: (path) => request("remove", path, client.deleteFile(path)),

    rename: (oldPath, newPath, options) =>
      request("rename", oldPath, client.moveFile(oldPath, newPath, { ...options })),

    sink: (path) =>
      Sink.collect<Uint8Array>().pipe(
        Sink.mapEffect((chunks) => put("sink", path, concatChunks(chunks))),
      ),

    stat: (path) => request("stat", path, client.stat(path)).pipe(Effect.map(toResourceInfo)),

    stream: (path, options) => readStream("stream", path, options),

    writeFile: (path, data, options) => put("writeFile", path, data, options),

    writeFileString: (path, data, options) =>
      put("writeFileString", path, new TextEncoder().encode(data), options),
  });
});

/**
 * A `FileSystem` backed by a WebDAV server.
 *
 * The client's `Auth` and `Transport` services are captured when the layer is
 * built, so they have to be provided alongside it, for example with
 * `WebDAV.ClientLayer`.
 */
export const layerWebDAV = (options: WebDAVOptions) =>
  Layer.effect(FileSystem, make(options.client));
