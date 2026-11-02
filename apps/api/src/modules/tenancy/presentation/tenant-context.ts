import {
  BadRequestException,
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { trace } from '@opentelemetry/api';
import { IdSchema } from '@repo/shared-types';
import type { AuthenticatedRequest } from '../../auth/presentation/decorators.js';
import { TENANT_REPOSITORY, type TenantRepository } from '../domain/ports/tenant.repository.js';
import { maySwitchToSandbox, resolveTenantId } from '../domain/tenant-context.js';

interface TenantRequest extends AuthenticatedRequest {
  tenantId?: string;
}

export const LIVE_ONLY_KEY = 'tenancy:liveOnly';
// Refused in test mode: what reaches the outside world for real, like an email or a charge.
export const LiveOnly = () => SetMetadata(LIVE_ONLY_KEY, true);

// Global, registered last (see AppModule), so the principal is verified and allowed on this route.
// Never reads the body. A guard, so a 400/403/404 is answered before any SSE stream starts.
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    if (req.principal) {
      const sandbox = req.headers['x-sandbox'];
      if (sandbox !== undefined && sandbox !== 'true') throw new BadRequestException('X-Sandbox must be true');
      if ((sandbox || req.principal.mode === 'test') && this.reflector.getAllAndOverride<boolean>(LIVE_ONLY_KEY, [ctx.getHandler(), ctx.getClass()])) {
        throw new ForbiddenException('Not available in test mode');
      }
      req.tenantId = sandbox ? await this.sandboxOf(req) : await this.resolve(req);
      // On traces only: as a metric label it would add a time series per tenant.
      trace.getActiveSpan()?.setAttribute('tenant.id', req.tenantId);
    }
    return true;
  }

  private sandboxOf({ principal, headers }: TenantRequest): Promise<string> {
    if (!maySwitchToSandbox(principal!) || headers['x-tenant-id'] !== undefined) throw new ForbiddenException('Test mode is for members of the tenant');
    return this.tenants.sandboxOf(principal!.tenantId);
  }

  private async resolve(req: TenantRequest): Promise<string> {
    const header = req.headers['x-tenant-id'];
    if (header !== undefined && !IdSchema.safeParse(header).success) {
      throw new BadRequestException('X-Tenant-Id must be a UUID');
    }
    const tenantId = resolveTenantId(req.principal!, header as string | undefined);
    if (!tenantId) throw new ForbiddenException('Cannot act on another tenant');
    if (tenantId !== req.principal!.tenantId && !(await this.tenants.findById(tenantId))) {
      throw new NotFoundException('Tenant not found');
    }
    return tenantId;
  }
}

// Throws instead of returning undefined: Prisma drops `where: { tenantId: undefined }`,
// which would silently query every tenant. Exported so the OpenAPI document can tell which routes honour X-Tenant-Id.
export function tenantIdOf(_: unknown, ctx: ExecutionContext): string {
  const tenantId = ctx.switchToHttp().getRequest<TenantRequest>().tenantId;
  if (!tenantId) throw new Error('Tenant context missing: @TenantId() used on a public route?');
  return tenantId;
}

export const TenantId = createParamDecorator(tenantIdOf);
