import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
  type Type,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef, Reflector } from '@nestjs/core';
import { metrics } from '@opentelemetry/api';
import type { AuthenticatedRequest } from '../../auth/presentation/decorators.js';
import { forwardedClientIp } from '../domain/forwarded-client.js';
import { RATE_LIMITER, type RateLimiter, type RateLimitResult } from '../domain/ports/rate-limiter.port.js';
import { planRateLimit, rateLimitAddress } from '../domain/rate-limit-policy.js';
import { FAIL_OPEN_KEY } from './fail-open.js';
import { TRUSTED_CALLER_KEY, type TrustedCallerCheck } from './trusted-caller.js';

const rejected = metrics.getMeter('rate-limit').createCounter('rate_limit.rejected', { description: 'Requests refused with 429' });

interface RateLimitedRequest extends AuthenticatedRequest {
  ip?: string;
  rawBody?: Buffer;
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
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    config: ConfigService,
  ) {
    this.forwardedIp = forwardedClientIp(config.get<string>('DASHBOARD_PROXY_SECRET') || undefined);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<RateLimitedRequest>();
    const res = http.getResponse<{ setHeader(name: string, value: number): void }>();
    // The browser's IP when the dashboard vouches for it; otherwise req.ip, which honours TRUST_PROXY_HOPS.
    req.clientIp = rateLimitAddress(this.forwardedIp(req.headers) ?? req.ip ?? 'unknown');
    // A provider proven by its signature (a webhook) is not limited: its own retries would otherwise be refused.
    const trusted = this.reflector.getAllAndOverride<Type<TrustedCallerCheck> | undefined>(TRUSTED_CALLER_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (trusted && this.moduleRef.get(trusted, { strict: false }).isTrusted(req)) return true;
    // Route pattern (/api-keys/:id), so every id shares one bucket.
    const plan = planRateLimit(req.principal ?? null, {
      ip: req.clientIp,
      method: req.method,
      route: req.route?.path ?? req.path,
    });

    let result: RateLimitResult;
    try {
      result = await this.limiter.consume(plan.key, plan.limit, plan.windowMs);
    } catch (err) {
      const failOpen = plan.failOpen || this.reflector.getAllAndOverride<boolean>(FAIL_OPEN_KEY, [ctx.getHandler(), ctx.getClass()]);
      // Message only: a stack trace per request floods the logs during an outage. Never plan.key: it can hold the client's IP.
      this.logger.error(
        `Rate limit check failed on ${req.method} ${req.route?.path ?? 'an unknown route'}, failing ${failOpen ? 'open' : 'closed'}: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (failOpen) return true;
      throw new ServiceUnavailableException();
    }

    res.setHeader('X-RateLimit-Limit', plan.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetSec);
    if (!result.allowed) {
      rejected.add(1, { scope: req.principal ? 'authenticated' : 'public' });
      res.setHeader('Retry-After', result.resetSec);
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
