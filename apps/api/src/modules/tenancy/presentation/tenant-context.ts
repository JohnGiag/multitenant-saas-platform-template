import {
  BadRequestException,
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { IdSchema } from '@repo/shared-types';
import type { AuthenticatedRequest } from '../../auth/presentation/decorators.js';
import { TENANT_REPOSITORY, type TenantRepository } from '../domain/ports/tenant.repository.js';
import { resolveTenantId } from '../domain/tenant-context.js';

interface TenantRequest extends AuthenticatedRequest {
  tenantId?: string;
}

// Global, registered last (see AppModule), so the principal is verified and allowed on this route.
// Never reads the body. A guard, so a 400/403/404 is answered before any SSE stream starts.
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    if (req.principal) req.tenantId = await this.resolve(req);
    return true;
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
// which would silently query every tenant.
export const TenantId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const tenantId = ctx.switchToHttp().getRequest<TenantRequest>().tenantId;
  if (!tenantId) throw new Error('Tenant context missing: @TenantId() used on a public route?');
  return tenantId;
});
