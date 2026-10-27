import type { CreateApiKeyDto, CreatedApiKey, Principal } from '@repo/shared-types';

export const API_KEY_SERVICE = Symbol('ApiKeyService');

export interface ApiKeyService {
  create(tenantId: string, input: CreateApiKeyDto): Promise<CreatedApiKey>;
  // False when the key does not exist in this tenant or is already revoked.
  revoke(tenantId: string, id: string): Promise<boolean>;
  // Returns null for malformed, unknown or revoked keys.
  verify(rawKey: string): Promise<Principal | null>;
}
