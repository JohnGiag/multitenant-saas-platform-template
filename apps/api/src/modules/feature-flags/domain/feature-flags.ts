import { TenantTierSchema, type FeatureFlag, type FeatureFlagDefinition, type TenantTier } from '@repo/shared-types';
import type { FeatureFlagRepository } from './ports/feature-flag.repository.js';

const rank = (tier: TenantTier) => TenantTierSchema.options.indexOf(tier);

// An override wins, whatever the tier; without one, the tier decides.
export function resolveFlag({ minTier }: FeatureFlagDefinition, tier: TenantTier, override: boolean | undefined): boolean {
  return override ?? (minTier !== null && rank(tier) >= rank(minTier));
}

// What a tenant may use. Reads the tenant's stored tier, never principal.tier: that one comes from a token (up to 15
// minutes old), and under X-Tenant-Id it is the SuperAdmin's own tenant's.
// shortcut: one query per check, so changes apply at once; cache it (and invalidate on tier and override changes) if a
// gated route gets hot.
export class FeatureFlags {
  constructor(
    private readonly definitions: readonly FeatureFlagDefinition[],
    private readonly repository: FeatureFlagRepository,
  ) {}

  declares(key: string): boolean {
    return this.definitions.some((d) => d.key === key);
  }

  async list(tenantId: string): Promise<FeatureFlag[]> {
    const state = await this.repository.load(tenantId);
    if (!state) return [];
    return this.definitions
      .map((definition) => {
        const override = state.overrides.get(definition.key);
        return { ...definition, override: override ?? null, enabled: resolveFlag(definition, state.tier, override) };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  // For code without a route (workers, listeners); routes use @RequireFeature. False for a tenant that no longer exists.
  async isEnabled(tenantId: string, key: string): Promise<boolean> {
    // A typo here would otherwise look like a feature that is off.
    if (!this.declares(key)) throw new Error(`Feature flag "${key}" is not declared by any installed module`);
    return (await this.list(tenantId)).find((flag) => flag.key === key)?.enabled ?? false;
  }
}
