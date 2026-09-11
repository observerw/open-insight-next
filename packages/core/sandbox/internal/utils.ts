import { Match } from "effect";
import type { ChildProcess as CP } from "effect/unstable/process";

export const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export const format = (command: CP.Command): string =>
  Match.value(command).pipe(
    Match.tag(
      "StandardCommand",
      ({ command, args }) => [command, ...args].map(quote).join(" "),
    ),
    Match.tag(
      "PipedCommand",
      ({ left, right }) => `${format(left)} | ${format(right)}`,
    ),
    Match.exhaustive,
  );
export type TemplateValue = string | number | boolean;
export type TemplateExpression = TemplateValue | ReadonlyArray<TemplateValue>;

const formatValue = (value: TemplateExpression | undefined): string =>
  value === undefined
    ? ""
    : Array.isArray(value)
    ? value.map((item) => quote(String(item))).join(" ")
    : quote(String(value));

export const makeScript = (
  strings: TemplateStringsArray,
  values: ReadonlyArray<TemplateExpression>,
): string =>
  strings
    .slice(0, -1)
    .map((string, index) => `${string}${formatValue(values[index])}`)
    .concat(strings.at(-1) ?? "")
    .join("");
