import { setTimeout } from 'node:timers/promises';
import { Injectable, Logger, SetMetadata, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { Principal } from '@repo/shared-types';
import { mergeMap, type Observable } from 'rxjs';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { READ_METHODS } from '../../auth/domain/access-policy.js';

interface AuditedRequest {
  method: string;
  principal?: Principal | null;
  // Set by TenantContextGuard: the tenant the request acted on.
  tenantId?: string;
  route?: { path?: string };
  params?: Record<string, string>;
}

export const NOT_AUDITED_KEY = 'audit:notAudited';
// For high-volume machine traffic that is no person's action (a tenant's server sending data), which would bury the
// log and cost an insert per call. Never on a route a person uses to change something.
export const NotAudited = () => SetMetadata(NOT_AUDITED_KEY, true);

// Records every successful write by a signed-in user or API key (ISO 27001), after its handler
// succeeded: rejected and failed requests never get here. It never rejects anything, so an
// interceptor (which runs after the guards) is the right place.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuditedRequest>();
    const principal = req.principal;
    if (!principal || READ_METHODS.has(req.method)) return next.handle();
    if (this.reflector.getAllAndOverride<boolean>(NOT_AUDITED_KEY, [ctx.getHandler(), ctx.getClass()])) return next.handle();
    // Express applies @HttpCode after the interceptors, so read it from the route instead.
    const status =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, ctx.getHandler()) ?? (req.method === 'POST' ? 201 : 200);
    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        await this.record(req, principal, status);
        return body;
      }),
    );
  }

  private async record(req: AuditedRequest, actor: Principal, status: number): Promise<void> {
    const data = {
      tenantId: actor.tenantId,
      actorKind: actor.kind,
      actorId: actor.id,
      actorRole: actor.role,
      actedOnTenantId: req.tenantId && req.tenantId !== actor.tenantId ? req.tenantId : null,
      method: req.method,
      route: req.route?.path ?? 'unknown',
      targetId: req.params?.id ?? null,
      status,
    };
    try {
      // Once more after a short pause: a pool or connection blip should not cost an audit row.
      await this.prisma.auditLog.create({ data }).catch(async () => {
        await setTimeout(200);
        await this.prisma.auditLog.create({ data });
      });
    } catch (err) {
      // The action already happened: failing its response now would only make the client retry it.
      this.logger.error(
        `Audit record lost for ${req.method} ${req.route?.path} by ${actor.kind} ${actor.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
