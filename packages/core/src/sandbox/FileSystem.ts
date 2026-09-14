import { Context, Effect, Layer, Option, Schema, Sink, Stream, type Types } from "effect";
import { operationFailed, type SandboxError } from "./SandboxError.ts";

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
     */
    readonly access: (path: string) => Effect.Effect<void, SandboxError>;

    /**
     * Checks whether a path exists.
     */
    readonly exists: (path: string) => Effect.Effect<boolean, SandboxError>;

    /**
     * Copy a file or directory from `fromPath` to `toPath`.
     */
    readonly copy: (
      fromPath: string,
      toPath: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

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
     * Get information about a file at `path`.
     */
    readonly stat: (path: string) => Effect.Effect<ResourceInfo, SandboxError>;

    /**
     * Create a readable `Stream` for the specified `path`.
     */
    readonly stream: (
      path: string,
      options?: {
        readonly bytesToRead?: bigint;
        readonly offset?: bigint;
      },
    ) => Stream.Stream<Uint8Array, SandboxError>;

    /**
     * Create a writable `Sink` for the specified `path`.
     */
    readonly sink: (path: string) => Sink.Sink<void, Uint8Array, never, SandboxError>;

    /**
     * Read text lines from a file at `path`.
     */
    readonly readLines: (
      path: string,
      options: { startLine?: number; encoding?: string },
    ) => Stream.Stream<string, SandboxError>;

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

    readonly replaceLines: (
      path: string,
      options: { startLine?: number; encoding?: string },
    ) => Effect.Effect<void, SandboxError>;
  }
>()("@open-insight/agent/fs/FileSystem") {}
