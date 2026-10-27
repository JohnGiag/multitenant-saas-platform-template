import type { AdminUpdateTenantDto, CreateTenantDto, CursorPage, Tenant, TenantPageQuery } from '@repo/shared-types';

export const TENANT_REPOSITORY = Symbol('TenantRepository');

export type DeleteTenantResult = 'deleted' | 'not_found' | 'has_data';

export interface TenantRepository {
  create(input: CreateTenantDto): Promise<Tenant>;
  list(query: TenantPageQuery): Promise<CursorPage<Tenant>>;
  findById(id: string): Promise<Tenant | null>;
  update(id: string, input: AdminUpdateTenantDto): Promise<Tenant | null>;
  // Refuses ('has_data') while users, keys or integrations still reference the tenant.
  delete(id: string): Promise<DeleteTenantResult>;
}
