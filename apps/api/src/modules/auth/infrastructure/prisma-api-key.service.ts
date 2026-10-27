import { Injectable } from '@nestjs/common';
import type { CreateApiKeyDto, CreatedApiKey, Principal } from '@repo/shared-types';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { apiKeySecretMatches, generateApiKey, hashApiKeySecret, parseApiKey } from '../domain/api-key.js';
import type { ApiKeyService } from '../domain/ports/api-key.port.js';

@Injectable()
export class PrismaApiKeyService implements ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, { name, role }: CreateApiKeyDto): Promise<CreatedApiKey> {
    const key = generateApiKey();
    const row = await this.prisma.apiKey.create({
      data: { tenantId, name, role, prefix: key.prefix, secretHash: hashApiKeySecret(key.secret) },
    });
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      prefix: row.prefix,
      key: key.raw,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async revoke(tenantId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.apiKey.updateMany({
      where: { id, tenantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1;
  }

  async verify(rawKey: string): Promise<Principal | null> {
    const parsed = parseApiKey(rawKey);
    if (!parsed) return null;
    const row = await this.prisma.apiKey.findUnique({ where: { prefix: parsed.prefix } });
    if (!row || row.revokedAt || !apiKeySecretMatches(parsed.secret, row.secretHash)) return null;
    return { kind: 'apiKey', id: row.id, tenantId: row.tenantId, role: row.role };
  }
}
