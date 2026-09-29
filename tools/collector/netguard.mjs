// The network-path guard (G17.16, issue #375): before the collector makes a
// network request — a crawl page, a MediaWiki API call, a video cover — the
// address is checked: the scheme must be http/https and the host must resolve
// to public addresses only. A host that resolves into loopback, a private or a
// reserved range (RFC1918, link-local, ULA, 0.0.0.0, multicast, …) refuses the
// request with a named diagnostic and the run continues — the barrier against
// «сід, які паказвае ўнутр», including through DNS
// (docs/24_web_collection.md, the collector's network barriers).
//
// Known limitation, out of scope by the issue: the check and the connection
// are not atomic. DNS rebinding between this lookup and the browser's own
// connection (Playwright connects itself) is not covered — the barrier stands
// at address selection, before the URL is handed to the transport.
import dns from 'node:dns';
import { BlockList, isIP } from 'node:net';

// Refused address space: name → subnets. The first matching group names the
// refusal, so the diagnostic says what the address is, not just that it is
// bad. net's BlockList normalizes IPv4 (and IPv4-mapped IPv6, in any spelling)
// to its embedded IPv4 form, so the IPv4 subnets below classify mapped
// literals too — the dotted-quad unwrap in classifyAddress pins the same
// semantics explicitly.
const REFUSED_RANGES = [
  ['unspecified', ['0.0.0.0/8', '::/128']],
  ['loopback', ['127.0.0.0/8', '::1/128']],
  ['private (RFC1918)', ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']],
  ['link-local', ['169.254.0.0/16', 'fe80::/10']],
  ['unique-local (ULA)', ['fc00::/7']],
  ['multicast', ['224.0.0.0/4', 'ff00::/8']],
  ['reserved', ['240.0.0.0/4', '100.64.0.0/10', '198.18.0.0/15', '100::/64']],
  ['documentation', ['192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24', '2001:db8::/32']],
].map(([reason, subnets]) => {
  const list = new BlockList();
  for (const subnet of subnets) {
    const [address, prefix] = subnet.split('/');
    list.addSubnet(address, Number(prefix), address.includes(':') ? 'ipv6' : 'ipv4');
  }
  return [reason, list];
});

// The refusal reason for one address, or null when it is public. An address
// net cannot parse is 'unparseable' — fail closed, like the fence.
export function classifyAddress(address) {
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) address = mapped[1];
  const family = isIP(address);
  if (family === 0) return 'unparseable';
  for (const [reason, list] of REFUSED_RANGES) {
    if (list.check(address, family === 4 ? 'ipv4' : 'ipv6')) return reason;
  }
  return null;
}

// The default resolver: every address the OS answers for the host — one
// private A/AAAA record among public ones refuses the request.
function defaultResolve(host) {
  return dns.promises.lookup(host, { all: true, verbatim: true });
}

// Returns the guard: async guardNetworkUrl(url) — resolves when the request
// may proceed, rejects with a named diagnostic otherwise. `resolve` is the
// injection seam for tests (no test touches the network).
export function createNetGuard({ resolve = defaultResolve } = {}) {
  return async function guardNetworkUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('net guard: the URL does not parse — refusing to fetch');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`net guard: '${parsed.protocol.slice(0, -1)}' is not http/https — refusing to fetch`);
    }
    // URL.hostname keeps the brackets of an IPv6 literal — strip them before
    // the literal check, a literal host never needs the resolver.
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) !== 0) {
      const reason = classifyAddress(host);
      if (reason) throw new Error(`net guard: ${host} is a ${reason} address — request not made`);
      return;
    }
    let addresses;
    try {
      addresses = await resolve(host);
    } catch (error) {
      const code = error?.code ?? error?.message ?? 'unknown error';
      throw new Error(`net guard: ${host} did not resolve (${code}) — request not made`);
    }
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new Error(`net guard: ${host} did not resolve — request not made`);
    }
    for (const { address } of addresses) {
      const reason = classifyAddress(address);
      if (reason) {
        throw new Error(`net guard: ${host} resolved to ${address}, a ${reason} address — request not made`);
      }
    }
  };
}
