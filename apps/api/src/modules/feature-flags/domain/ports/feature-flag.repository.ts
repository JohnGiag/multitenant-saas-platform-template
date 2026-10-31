import type { TenantTier } from '@repo/shared-types';

export const FEATURE_FLAG_REPOSITORY = Symbol('FeatureFlagRepository');

export interface TenantFeatureState {
  tier: TenantTier;
  overrides: ReadonlyMap<string, boolean>;
}

export interface FeatureFlagRepository {
  // The tenant's stored tier and overrides; null if it no longer exists.
  load(tenantId: string): Promise<TenantFeatureState | null>;
  setOverride(tenantId: string, key: string, enabled: boolean): Promise<void>;
  clearOverride(tenantId: string, key: string): Promise<void>;
}
