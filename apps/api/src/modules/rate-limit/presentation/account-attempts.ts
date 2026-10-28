import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import type { RateLimiter } from '../domain/ports/rate-limiter.port.js';
import { LOGIN_ACCOUNT_LIMIT, LOGIN_ACCOUNT_WINDOW_MS, perIp } from '../domain/rate-limit-policy.js';

type Res = { setHeader(name: string, value: number): void };

// Counts one attempt against an account, before the password is checked: in the account's bucket for this
// IP first, so a blocked address does not use up the ceiling, then in the bucket shared by all IPs.
export async function countAccountAttempt(limiter: RateLimiter, key: string, ip: string, ceiling: number, res: Res): Promise<void> {
  await consume(limiter, perIp(key, ip), LOGIN_ACCOUNT_LIMIT, res);
  await consume(limiter, key, ceiling, res);
}

// A signed-in caller changing their own password: one bucket per account, whatever the IP.
export const countOwnAttempt = (limiter: RateLimiter, key: string, res: Res) => consume(limiter, key, LOGIN_ACCOUNT_LIMIT, res);

// 429 with Retry-After once over the limit; 503 if Redis is down (fails closed).
async function consume(limiter: RateLimiter, key: string, limit: number, res: Res): Promise<void> {
  const attempt = await limiter.consume(key, limit, LOGIN_ACCOUNT_WINDOW_MS).catch(() => {
    throw new ServiceUnavailableException();
  });
  if (!attempt.allowed) {
    res.setHeader('Retry-After', attempt.resetSec);
    throw new HttpException('Too many password attempts for this account', HttpStatus.TOO_MANY_REQUESTS);
  }
}

// After the right password: this IP's failures no longer count (or, without an `ip`, the bucket `key` itself).
// The shared ceiling is left alone, so a stranger holding one valid account cannot use it to reset the count
// for guessing another. If Redis hiccups, the bucket just expires.
export async function clearAccountAttempts(limiter: RateLimiter, key: string, ip?: string): Promise<void> {
  await limiter.reset(ip === undefined ? key : perIp(key, ip)).catch(() => undefined);
}
