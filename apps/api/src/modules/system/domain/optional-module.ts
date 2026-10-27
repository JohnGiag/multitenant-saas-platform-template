import type { Capability } from '@repo/shared-types';

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
  // The module's root NestJS module class.
  module: new (...args: any[]) => unknown;
}

export function toCapabilities(
  modules: readonly OptionalModule[],
  enabledIntegrations: ReadonlySet<string>,
  setting: PlatformSetting,
): Capability[] {
  return modules
    .map(({ key, integration, worksWithoutIntegration }) => ({
      key,
      integration: integration ?? null,
      enabled:
        integration === undefined ||
        enabledIntegrations.has(integration) ||
        (worksWithoutIntegration?.(setting) ?? false),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
