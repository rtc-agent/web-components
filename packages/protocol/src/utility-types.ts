/**
 * Protocol Utility Types
 *
 * Generic TypeScript utility types for protocol type manipulation.
 * These utilities are protocol-agnostic and can be used across packages.
 */

/**
 * Unpacked - Extract element type from array type
 *
 * If T is an array type, extracts the element type.
 * Otherwise, returns T unchanged.
 *
 * @example
 * ```typescript
 * type A = string[];
 * type B = Unpacked<A>; // string
 *
 * type C = string;
 * type D = Unpacked<C>; // string
 * ```
 */
export type Unpacked<T> = T extends (infer U)[] ? U : T;

/**
 * Nullable - Make a type nullable (null or undefined)
 *
 * @example
 * ```typescript
 * type A = Nullable<string>; // string | null | undefined
 * ```
 */
export type Nullable<T> = T | null | undefined;

/**
 * DeepPartial - Make all properties recursively optional
 *
 * @example
 * ```typescript
 * interface User { name: string; address: { city: string } }
 * type PartialUser = DeepPartial<User>;
 * // { name?: string; address?: { city?: string } }
 * ```
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * DeepReadonly - Make all properties recursively readonly
 *
 * @example
 * ```typescript
 * interface Config { database: { host: string } }
 * type ReadonlyConfig = DeepReadonly<Config>;
 * // { readonly database: { readonly host: string } }
 * ```
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};
