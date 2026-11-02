import { Injectable } from '@nestjs/common';
import { RetentionSweep } from '../../../common/retention-sweep.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { IDEMPOTENCY_TTL_MS, type IdempotencyClaim, type IdempotencyRecord, type IdempotencyStatus } from '../domain/idempotency-policy.js';
import type { IdempotencyStore } from '../domain/ports/idempotency-store.port.js';

@Injectable()
export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(claim: IdempotencyClaim): Promise<boolean> {
    const { count } = await this.prisma.idempotencyKey.createMany({ data: { ...claim, status: 'in_progress' }, skipDuplicates: true });
    return count === 1;
  }

  async find(tenantId: string, key: string): Promise<IdempotencyRecord | null> {
    const row = await this.prisma.idempotencyKey.findUnique({ where: { tenantId_key: { tenantId, key } } });
    return row && { ...row, status: row.status as IdempotencyStatus };
  }

  async takeOver({ id, createdAt }: IdempotencyRecord, { tenantId, principalId, requestHash }: IdempotencyClaim): Promise<boolean> {
    const { count } = await this.prisma.idempotencyKey.updateMany({
      where: { id, tenantId, createdAt },
      data: { principalId, requestHash, status: 'in_progress', responseBody: undefined, createdAt: new Date() },
    });
    return count === 1;
  }

  async finish(tenantId: string, key: string, status: 'done' | 'secret', responseBody?: unknown): Promise<void> {
    // Through JSON, so what is stored is exactly what the client received.
    const stored = responseBody === undefined ? undefined : (JSON.parse(JSON.stringify(responseBody)) as object);
    await this.prisma.idempotencyKey.updateMany({ where: { tenantId, key }, data: { status, responseBody: stored } });
  }

  async release(tenantId: string, key: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({ where: { tenantId, key, status: 'in_progress' } });
  }
}

@Injectable()
export class IdempotencySweep extends RetentionSweep {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  protected sweep() {
    return this.prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - IDEMPOTENCY_TTL_MS) } } });
  }
}
