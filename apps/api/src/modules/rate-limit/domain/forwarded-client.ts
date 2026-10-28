import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { CLIENT_IP_HEADER, DASHBOARD_SECRET_HEADER } from '@repo/shared-types';

type Headers = Record<string, string | string[] | undefined>;

const digest = (value: string) => createHash('sha256').update(value).digest();

// Every browser reaches public routes (login, invitations, resets) through the dashboard's server, so without
// this they would all share its IP and one rate-limit bucket. The dashboard forwards the browser's IP with a
// shared secret; the IP is believed only when the secret matches, so no other caller picks its own bucket.
// Without a secret configured, nothing is believed.
export function forwardedClientIp(secret: string | undefined): (headers: Headers) => string | null {
  if (!secret) return () => null;
  // Digests: equal lengths for timingSafeEqual, and the comparison time says nothing about the secret's length.
  const expected = digest(secret);
  return (headers) => {
    const given = headers[DASHBOARD_SECRET_HEADER];
    const ip = headers[CLIENT_IP_HEADER];
    if (typeof given !== 'string' || typeof ip !== 'string' || isIP(ip) === 0) return null;
    return timingSafeEqual(digest(given), expected) ? ip : null;
  };
}
