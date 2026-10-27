import type { AdminUpdateTenantDto, CreateTenantDto, CursorPage, Tenant, TenantPageQuery } from '@repo/shared-types';

export const TENANT_REPOSITORY = Symbol('TenantRepository');

export interface TenantRepository {
  create(input: CreateTenantDto): Promise<Tenant>;
  list(query: TenantPageQuery): Promise<CursorPage<Tenant>>;
  findById(id: string): Promise<Tenant | null>;
  update(id: string, input: AdminUpdateTenantDto): Promise<Tenant | null>;
  // The tenant and everything in it (users, keys, invitations, integrations), atomically.
  // 'protected': the platform tenant (it holds the SuperAdmin accounts) is never deleted.
  delete(id: string): Promise<'deleted' | 'not_found' | 'protected'>;
}
