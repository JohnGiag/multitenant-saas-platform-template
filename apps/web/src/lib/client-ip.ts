import { isIP } from 'node:net';

// TRUST_PROXY_HOPS: the proxies in front of this dashboard (load balancer, Vercel, nginx). 0 when browsers reach
// it directly: Next.js keeps an X-Forwarded-For the browser sent itself, so nothing in it can be trusted.
export function parseProxyHops(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0) throw new Error(`TRUST_PROXY_HOPS must be an integer >= 0, got "${raw}"`);
  return hops;
}

// The browser's IP as our own proxies recorded it: `hops` entries from the right of X-Forwarded-For. Entries
// further left came from the browser, so they are never read.
export function clientIpFrom(forwardedFor: string | null, hops: number): string | undefined {
  if (hops === 0 || !forwardedFor) return undefined;
  const entries = forwardedFor.split(',').map((entry) => entry.trim());
  const ip = entries[entries.length - hops];
  return ip && isIP(ip) ? ip : undefined;
}
