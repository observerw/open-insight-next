import { Schema } from "effect";
import { isAllowedHost, isAllowedHostsForMode } from "./internal/network-policy.ts";

export { isAllowedHost } from "./internal/network-policy.ts";

export const Mode = Schema.Union([
  Schema.Literal("public"),
  Schema.Literal("no-network"),
  Schema.Literal("allowlist"),
]);

export type Mode = Schema.Schema.Type<typeof Mode>;

export const AllowedHost = Schema.String.check(
  Schema.makeFilter(isAllowedHost, {
    expected:
      "an exact hostname, leading-wildcard hostname, IP address, or CIDR without a URL, port, or path",
  }),
);

export type AllowedHost = Schema.Schema.Type<typeof AllowedHost>;

const PolicyFields = Schema.Struct({
  mode: Mode,
  allowedHosts: Schema.Array(AllowedHost),
}).check(
  Schema.makeFilter(isAllowedHostsForMode, {
    expected: "allowedHosts to be empty unless mode is allowlist",
  }),
);

export class NetworkPolicy extends Schema.Class<NetworkPolicy>("NetworkPolicy")(PolicyFields) {}
