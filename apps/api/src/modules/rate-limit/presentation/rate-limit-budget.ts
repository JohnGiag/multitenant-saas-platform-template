import { SetMetadata } from '@nestjs/common';
import type { RouteBudget } from '../domain/rate-limit-policy.js';

export const RATE_LIMIT_BUDGET_KEY = 'rateLimit:budget';

export interface RateLimitBudgetOptions extends RouteBudget {
  // Units this request spends, at least 1. Runs before validation, so `body` is whatever the client sent.
  cost: (body: unknown) => number;
}

// For a route whose requests differ in size (a batch): signed-in callers and API keys spend this budget on it, by what
// each request costs, instead of one of their requests per minute. Unauthenticated requests are limited per IP as usual.
export const RateLimitBudget = (budget: RateLimitBudgetOptions) => SetMetadata(RATE_LIMIT_BUDGET_KEY, budget);
