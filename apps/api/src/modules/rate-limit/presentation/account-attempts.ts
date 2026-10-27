import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import type { RateLimiter } from '../domain/ports/rate-limiter.port.js';
import { LOGIN_ACCOUNT_LIMIT, LOGIN_ACCOUNT_WINDOW_MS } from '../domain/rate-limit-policy.js';

// Counts one password attempt against an account, before the password is checked.
// 429 with Retry-After once over the limit; 503 if Redis is down (fails closed).
export async function countAccountAttempt(
  limiter: RateLimiter,
  key: string,
  res: { setHeader(name: string, value: number): void },
): Promise<void> {
  const attempt = await limiter.consume(key, LOGIN_ACCOUNT_LIMIT, LOGIN_ACCOUNT_WINDOW_MS).catch(() => {
    throw new ServiceUnavailableException();
  });
  if (!attempt.allowed) {
    res.setHeader('Retry-After', attempt.resetSec);
    throw new HttpException('Too many password attempts for this account', HttpStatus.TOO_MANY_REQUESTS);
  }
}

// After the right password: the account's failures no longer count. If Redis hiccups, the bucket just expires.
export async function clearAccountAttempts(limiter: RateLimiter, key: string): Promise<void> {
  await limiter.reset(key).catch(() => undefined);
}
