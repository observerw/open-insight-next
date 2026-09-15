import validator from "validator";

const fqdnOptions = {
  allow_trailing_dot: true,
  allow_wildcard: true,
  require_tld: false,
};

export const isAllowedHost = (value: string): boolean => {
  const host = value.trim();

  if (host.length === 0 || host.includes("[") || host.includes("]")) {
    return false;
  }

  return validator.isIP(host) || validator.isIPRange(host) || validator.isFQDN(host, fqdnOptions);
};

export const isAllowedHostsForMode = ({
  mode,
  allowedHosts,
}: {
  readonly mode: string;
  readonly allowedHosts: ReadonlyArray<unknown>;
}): boolean => mode === "allowlist" || allowedHosts.length === 0;
