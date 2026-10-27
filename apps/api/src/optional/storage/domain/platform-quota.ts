// The platform bucket serves every tenant without a bucket of its own, at the platform's cost, so each
// tenant gets only a little of it. The file cap stops a tenant from storing millions of tiny files.
export const PLATFORM_QUOTA = { bytes: 100 * 1024 * 1024, objects: 1000 };

export function fitsPlatformQuota(used: { bytes: number; objects: number }, size: number): boolean {
  return used.objects < PLATFORM_QUOTA.objects && used.bytes + size <= PLATFORM_QUOTA.bytes;
}
