export function assertNonNull<T>(val: T): asserts val is NonNullable<T> {
  if (val === null || val === undefined) {
    throw new Error("Value cannot be null or undefined");
  }
}

export type Exact<A, B> = A extends B ? (B extends A ? A : never) : never;

/**
 * Override properties of the T with properties from the U.
 *
 * Useful when original type already has a variant of the U but needs to be overridden with other variants.
 */
export type Override<T, U> = Omit<T, keyof U> & U;

/**
 * Preserve a keyed record or index an array of records by one of their keys.
 */
export type IndexByKey<T, Key extends PropertyKey> =
  T extends Record<string, unknown>
    ? { readonly [Name in keyof T]: T[Name] }
    : T extends ReadonlyArray<infer Item>
      ? {
          readonly [Value in Item extends Record<Key, PropertyKey> ? Item[Key] : never]: Item;
        }
      : never;
