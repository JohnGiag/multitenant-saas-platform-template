// Runs inside ConfigModule.forRoot, before any provider exists, so a bad value fails the boot before
// anything opens a connection (a failed boot with open BullMQ connections would hang instead of exit).
// Values that need a provider to parse (JWT_SECRET, BYOK_MASTER_KEY, job tuning) are checked where used.
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const provider = env.AUTH_PROVIDER ?? 'local';
  if (provider !== 'local' && provider !== 'clerk') {
    throw new Error(`Unknown AUTH_PROVIDER "${String(provider)}" (expected "local" or "clerk")`);
  }
  return env;
}
