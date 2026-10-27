import type { Capability } from '@repo/shared-types';

export const OPTIONAL_MODULES = Symbol('OptionalModules');

// Contract every folder in src/optional/<key>/ default-exports from its index.ts.
export interface OptionalModule {
  // Capability key reported to the dashboard, e.g. "storage".
  key: string;
  // tenant_integrations provider that switches it on per tenant; omit if it needs no tenant config.
  integration?: string;
  // The module's root NestJS module class.
  module: new (...args: any[]) => unknown;
}

export function toCapabilities(modules: readonly OptionalModule[], enabledIntegrations: ReadonlySet<string>): Capability[] {
  return modules
    .map(({ key, integration }) => ({
      key,
      integration: integration ?? null,
      enabled: integration === undefined || enabledIntegrations.has(integration),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
