import { SetMetadata, type Type } from '@nestjs/common';

export const TRUSTED_CALLER_KEY = 'rateLimit:trustedCaller';

// Proves that a request comes from a known provider, such as a valid webhook signature. Runs on every request to the
// route before any limit, so it must be cheap and make no network or database call.
export interface TrustedCallerCheck {
  isTrusted(req: { headers: Record<string, string | string[] | undefined>; rawBody?: Buffer }): boolean;
}

// Requests that pass `check` (a provider of the route's module) skip the rate limit; every other request to the route
// is limited as usual, so a flood of forged calls is still stopped.
export const ExemptTrustedCaller = (check: Type<TrustedCallerCheck>) => SetMetadata(TRUSTED_CALLER_KEY, check);
