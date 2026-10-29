// Standard Webhooks' retry schedule (Svix's): a receiver down for a deploy or overnight still gets every event.
// Waits before attempts 2 to 8, about 27 hours in all; after the 8th failure the delivery goes to the dead-letter queue.
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
export const RETRY_DELAYS_MS = [5 * SECOND, 5 * MINUTE, 30 * MINUTE, 2 * HOUR, 5 * HOUR, 10 * HOUR, 10 * HOUR] as const;
export const DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

// `attemptsMade`: failed attempts so far (1 after the first).
export function retryDelay(attemptsMade: number): number {
  return RETRY_DELAYS_MS[Math.min(attemptsMade, RETRY_DELAYS_MS.length) - 1] ?? RETRY_DELAYS_MS[0];
}

// A timeout, rate limit or server error may pass; any other refusal (404, 401, 400…) will not, so it is not retried.
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

// Checked when an endpoint is saved, for a clear 400. The address check that matters runs on every delivery, against
// the address actually connected to (a hostname can resolve differently later).
export function endpointUrlProblem(raw: string, allowPrivate: boolean): string | null {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) return 'Webhook URLs must use https';
  if (url.username || url.password) return 'Webhook URLs must not contain credentials';
  return null;
}
