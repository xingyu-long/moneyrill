/** Which Host headers and Origins the API accepts. Local only, unless LAN mode or a Tailscale name is switched on. */
const LOCAL = ['localhost', '127.0.0.1'];

export function isPrivateAddress(host: string) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return false;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/i.test(host);
}

export function isAllowedHost(
  hostHeader: string | undefined,
  allowLan: boolean,
  tailscaleHost = '',
) {
  const host = (hostHeader || '').split(':')[0].toLowerCase();
  return (
    LOCAL.includes(host) ||
    (allowLan && isPrivateAddress(host)) ||
    (!!tailscaleHost && host === tailscaleHost)
  );
}

/**
 * An Origin is fine if it is the configured one, or the same site the request came to: `http://` in LAN mode,
 * `https://` on the Tailscale name (`tailscale serve` terminates HTTPS and keeps the Host).
 */
export function isAllowedOrigin(
  origin: string,
  hostHeader: string | undefined,
  configured: string,
  allowLan: boolean,
  tailscaleHost = '',
) {
  if ([configured, configured.replace('localhost', '127.0.0.1')].includes(origin)) return true;
  if (allowLan && isAllowedHost(hostHeader, true) && origin === `http://${hostHeader}`) return true;
  return (
    !!tailscaleHost &&
    isAllowedHost(hostHeader, false, tailscaleHost) &&
    origin === `https://${hostHeader}`
  );
}
