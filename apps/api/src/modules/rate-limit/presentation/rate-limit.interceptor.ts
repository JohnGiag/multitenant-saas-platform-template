import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../../auth/presentation/decorators.js';
import { RATE_LIMITER, type RateLimiter, type RateLimitResult } from '../domain/ports/rate-limiter.port.js';
import { planRateLimit } from '../domain/rate-limit-policy.js';

interface RateLimitedRequest extends AuthenticatedRequest {
  ip?: string;
  path: string;
  route?: { path?: string };
}

// Global. An interceptor rather than a guard because interceptors always run after every guard,
// so the principal set by AuthGuard is known here regardless of guard registration order.
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RateLimit');

  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<RateLimitedRequest>();
    const res = http.getResponse<{ setHeader(name: string, value: number): void }>();
    // req.ip honours TRUST_PROXY_HOPS. Route pattern (/api-keys/:id), so every id shares one bucket.
    const plan = planRateLimit(req.principal ?? null, {
      ip: req.ip ?? 'unknown',
      method: req.method,
      route: req.route?.path ?? req.path,
    });

    let result: RateLimitResult;
    try {
      result = await this.limiter.consume(plan.key, plan.limit, plan.windowMs);
    } catch (err) {
      // Message only: a stack trace per request floods the logs during an outage.
      this.logger.error(
        `Rate limit check failed for ${plan.key}, failing ${plan.failOpen ? 'open' : 'closed'}: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (plan.failOpen) return next.handle();
      throw new ServiceUnavailableException();
    }

    res.setHeader('X-RateLimit-Limit', plan.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetSec);
    if (!result.allowed) {
      res.setHeader('Retry-After', result.resetSec);
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return next.handle();
  }
}
