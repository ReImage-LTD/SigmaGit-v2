import { BlockList, isIP } from 'node:net';

export function normalizeIp(value: string | undefined): string | null {
  if (!value || !isIP(value)) return null;
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const normalized = normalizeIp(ip);
  const [range, prefix, extra] = cidr.split('/');
  const address = normalizeIp(range);
  if (!normalized || !address || extra !== undefined) return false;
  if (prefix === undefined) return normalized === address;
  if (!/^\d+$/.test(prefix)) return false;
  const family = isIP(address) === 4 ? 'ipv4' : 'ipv6';
  const bits = Number(prefix);
  if (bits > (family === 'ipv4' ? 32 : 128)) return false;
  const block = new BlockList();
  block.addSubnet(address, bits, family);
  return block.check(normalized, isIP(normalized) === 4 ? 'ipv4' : 'ipv6');
}

export function resolveForwardedClientIp(
  peerIp: string | undefined,
  forwarded: string | undefined,
  trustedCidrs: string[],
): string | null {
  const peer = normalizeIp(peerIp);
  const trusted = (ip: string) => trustedCidrs.some((cidr) => ipInCidr(ip, cidr));
  if (!peer || !trusted(peer)) return null;
  const hops = (forwarded ?? '').split(',').map((hop) => normalizeIp(hop.trim()));
  // Invalid forwarding data must never become a caller-controlled bucket key.
  if (hops.some((hop) => hop === null)) return null;
  for (let index = hops.length - 1; index >= 0; index--) {
    if (!trusted(hops[index]!)) return hops[index];
  }
  return hops[0] ?? null;
}
