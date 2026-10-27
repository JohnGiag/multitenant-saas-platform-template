import { randomUUID } from 'node:crypto';

// "<tenantId>/<random>/<filename>": the tenant prefix isolates tenants sharing the platform bucket,
// the random segment keeps two uploads of the same filename from overwriting each other.
export function newObjectKey(tenantId: string, filename: string): string {
  return `${tenantId}/${randomUUID()}/${filename}`;
}

// Under the tenant's prefix, with no segment a URL could collapse ("", ".", "..") into another tenant's.
export function isTenantObjectKey(tenantId: string, key: string): boolean {
  const [prefix, ...rest] = key.split('/');
  return prefix === tenantId && rest.length > 0 && rest.every((s) => s !== '' && s !== '.' && s !== '..');
}
