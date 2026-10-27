import {
  BadRequestException,
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { IdSchema } from '@repo/shared-types';
import type { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../../auth/presentation/decorators.js';
import { TENANT_REPOSITORY, type TenantRepository } from '../domain/ports/tenant.repository.js';
import { resolveTenantId } from '../domain/tenant-context.js';

interface TenantRequest extends AuthenticatedRequest {
  tenantId?: string;
}

// Global; runs after AuthGuard, so the principal is already verified. Never reads the body.
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    if (req.principal) req.tenantId = await this.resolve(req);
    return next.handle();
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
