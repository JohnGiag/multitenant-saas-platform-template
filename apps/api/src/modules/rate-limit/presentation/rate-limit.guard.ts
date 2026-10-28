import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedRequest } from '../../auth/presentation/decorators.js';
import { forwardedClientIp } from '../domain/forwarded-client.js';
import { RATE_LIMITER, type RateLimiter, type RateLimitResult } from '../domain/ports/rate-limiter.port.js';
import { planRateLimit } from '../domain/rate-limit-policy.js';

interface RateLimitedRequest extends AuthenticatedRequest {
  ip?: string;
  path: string;
  route?: { path?: string };
}

// Global, registered right after AuthGuard (see AppModule), so the principal is known.
// A guard, not an interceptor: Nest runs interceptors lazily, and on an SSE route that is after the
// stream has started, too late to answer 429 or set headers.
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger('RateLimit');

  private readonly forwardedIp: (headers: RateLimitedRequest['headers']) => string | null;

  constructor(
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    config: ConfigService,
  ) {
    this.forwardedIp = forwardedClientIp(config.get<string>('DASHBOARD_PROXY_SECRET') || undefined);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<RateLimitedRequest>();
    const res = http.getResponse<{ setHeader(name: string, value: number): void }>();
    // The browser's IP when the dashboard vouches for it; otherwise req.ip, which honours TRUST_PROXY_HOPS.
    // Route pattern (/api-keys/:id), so every id shares one bucket.
    req.clientIp = this.forwardedIp(req.headers) ?? req.ip ?? 'unknown';
    const plan = planRateLimit(req.principal ?? null, {
      ip: req.clientIp,
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
      if (plan.failOpen) return true;
      throw new ServiceUnavailableException();
    }

    res.setHeader('X-RateLimit-Limit', plan.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetSec);
    if (!result.allowed) {
      res.setHeader('Retry-After', result.resetSec);
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
