import type { Capability, FeatureFlagDefinition, MeterDefinition } from '@repo/shared-types';

export const OPTIONAL_MODULES = Symbol('OptionalModules');

// Reads a platform setting (environment variable); undefined when unset.
export type PlatformSetting = (name: string) => string | undefined;

// Contract every folder in src/optional/<key>/ default-exports from its index.ts.
export interface OptionalModule {
  // Capability key reported to the dashboard, e.g. "storage".
  key: string;
  // tenant_integrations provider that switches it on per tenant; omit if it needs no tenant config.
  integration?: string;
  // True when the platform's own settings make it usable for tenants without the integration
  // (e.g. a shared platform bucket). Omit if the integration is required.
  worksWithoutIntegration?: (setting: PlatformSetting) => boolean;
  // False while platform settings the module cannot work without are missing (e.g. billing without its Stripe
  // keys): it then stays installed but disabled for every tenant. Omit if it needs none.
  platformReady?: (setting: PlatformSetting) => boolean;
  // True if, while enabled, the module sets tenants' tiers itself (billing): core then refuses manual tier changes,
  // which the module's next update would silently undo.
  ownsTenantTier?: boolean;
  // Its feature flags, gone with the module. A flag with the module's own key gates the whole module: while it is off
  // for a tenant, the capability reports disabled.
  featureFlags?: FeatureFlagDefinition[];
  // What it counts per tenant for quotas and billing. Spent with UsageMeter.record, enforced with @EnforceQuota.
  meters?: MeterDefinition[];
  // The module's root NestJS module class.
  module: new (...args: any[]) => unknown;
}

export function isEnabled(
  { integration, worksWithoutIntegration, platformReady }: OptionalModule,
  enabledIntegrations: ReadonlySet<string>,
  setting: PlatformSetting,
): boolean {
  if (platformReady && !platformReady(setting)) return false;
  return integration === undefined || enabledIntegrations.has(integration) || (worksWithoutIntegration?.(setting) ?? false);
}

// Whether an enabled module sets tenant tiers (see ownsTenantTier). Platform-wide: such modules need no integration.
export const tierIsManaged = (modules: readonly OptionalModule[], setting: PlatformSetting) =>
  modules.some((m) => m.ownsTenantTier && isEnabled(m, new Set(), setting));

export function toCapabilities(
  modules: readonly OptionalModule[],
  enabledIntegrations: ReadonlySet<string>,
  setting: PlatformSetting,
  flagsOff: ReadonlySet<string>,
): Capability[] {
  return modules
    .map((module) => ({
      key: module.key,
      integration: module.integration ?? null,
      enabled: !flagsOff.has(module.key) && isEnabled(module, enabledIntegrations, setting),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
