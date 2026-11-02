import {
  applyDecorators,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tenantIdOf } from '../../tenancy/presentation/tenant-context.js';
import { nextPeriodStart } from '../domain/usage-policy.js';
import { UsageMeter } from '../domain/usage-meter.js';

export const QUOTA_KEY = 'usage:meter';

// A route guard, so the tenant is resolved and a 429 is answered before the handler or any SSE stream starts.
@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usage: UsageMeter,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meter = this.reflector.getAllAndOverride<string>(QUOTA_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!(await this.usage.isRefused(tenantIdOf(undefined, ctx), meter))) return true;
    const now = new Date();
    ctx.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>().setHeader('Retry-After', String(Math.ceil((nextPeriodStart(now).getTime() - now.getTime()) / 1000)));
    throw new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, code: 'quota_exceeded', meter, message: `Monthly quota reached for ${meter}` }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

// On a route that spends this meter: refuses with a 429 and code `quota_exceeded` while a hard limit is reached. The
// handler still calls UsageMeter.record, which knows the quantity.
export const EnforceQuota = (meter: string) => applyDecorators(SetMetadata(QUOTA_KEY, meter), UseGuards(QuotaGuard));
