import { Prompt, type Sandbox } from "@open-insight/core";

import { Effect, Equal, Schema } from "effect";
import type { GradeError } from "./GradeError.ts";

export type Context = Sandbox.Sandbox;

export type Verif<Result extends Schema.Constraint = any> = Readonly<{
  exec: (context: Context) => Effect.Effect<Prompt.Prompt, GradeError>;
  expect: Partial<Result["Type"]>;
}>;

export type Exec = (context: Context) => Effect.Effect<Prompt.RawInput, unknown>;

export const isMatch = <Result extends Schema.Constraint>({
  result,
  expect,
}: Readonly<{
  expect: Partial<Result["Type"]>;
  result: Result["Type"];
}>) => Equal.equals(result, Object.assign({}, result, expect));
