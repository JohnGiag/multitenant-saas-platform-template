import {
  applyDecorators,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tenantIdOf } from '../../tenancy/presentation/tenant-context.js';
import { FeatureFlags } from '../domain/feature-flags.js';

export const FEATURE_KEY = 'feature:key';

// Route guards run after the global chain, so the caller is allowed here and the tenant is resolved (X-Tenant-Id
// included). A guard, so a 403 is answered before any SSE stream starts.
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlags,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!(await this.flags.isEnabled(tenantIdOf(undefined, ctx), key))) {
      throw new ForbiddenException(`Feature not enabled for this tenant: ${key}`);
    }
    return true;
  }
}

// On a controller or a route. It only adds a check: @Roles still decides who gets in, SuperAdmin included.
export const RequireFeature = (key: string) => applyDecorators(SetMetadata(FEATURE_KEY, key), UseGuards(FeatureGuard));
