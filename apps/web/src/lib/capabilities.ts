import type { Capability, Role } from '@repo/shared-types';

export const capabilityTitle = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replaceAll('-', ' ');

// Settings tabs for installed modules that take tenant config. Integrations are the tenant's own secrets:
// TenantAdmin edits them, Auditor reads them (masked), SuperAdmin never sees them, User has nothing to set.
export function configurableCapabilities(capabilities: Capability[], role: Role): ConfigurableCapability[] {
  if (role !== 'TenantAdmin' && role !== 'Auditor') return [];
  return capabilities.filter((c): c is ConfigurableCapability => c.integration !== null);
}

export type ConfigurableCapability = Capability & { integration: string };
