import type {
  CursorPage,
  IntegrationPageQuery,
  TenantIntegration,
  UpsertTenantIntegrationDto,
} from '@repo/shared-types';

export const INTEGRATION_SERVICE = Symbol('IntegrationService');

export interface IntegrationService {
  list(tenantId: string, query: IntegrationPageQuery): Promise<CursorPage<TenantIntegration>>;
  // Replaces the provider's whole config.
  upsert(tenantId: string, provider: string, input: UpsertTenantIntegrationDto): Promise<TenantIntegration>;
  remove(tenantId: string, provider: string): Promise<boolean>;
  // For other modules, at the moment of use only. Null when missing or disabled; throws if tampered.
  getSecrets(tenantId: string, provider: string): Promise<Record<string, string> | null>;
  // Which of `providers` the tenant has configured and enabled. Never decrypts.
  enabledProviders(tenantId: string, providers: string[]): Promise<Set<string>>;
}
