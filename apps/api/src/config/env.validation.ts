// Runs inside ConfigModule.forRoot, before any provider exists, so a bad value fails the boot before
// anything opens a connection (a failed boot with open BullMQ connections would hang instead of exit).
// Values that need a provider to parse (JWT_SECRET, BYOK_MASTER_KEY, job tuning) are checked where used.
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const provider = env.AUTH_PROVIDER ?? 'local';
  if (provider !== 'local' && provider !== 'clerk') {
    throw new Error(`Unknown AUTH_PROVIDER "${String(provider)}" (expected "local" or "clerk")`);
  }
  if (provider === 'clerk') {
    if (typeof env.CLERK_ISSUER !== 'string' || !URL.canParse(env.CLERK_ISSUER)) {
      throw new Error('AUTH_PROVIDER=clerk needs CLERK_ISSUER: your Clerk Frontend API URL');
    }
    if (typeof env.CLERK_WEBHOOK_SECRET !== 'string' || !env.CLERK_WEBHOOK_SECRET.startsWith('whsec_')) {
      throw new Error('AUTH_PROVIDER=clerk needs CLERK_WEBHOOK_SECRET: the endpoint signing secret (whsec_…)');
    }
  }
  if (env.API_DOCS !== undefined && env.API_DOCS !== '' && env.API_DOCS !== 'true' && env.API_DOCS !== 'false') {
    throw new Error(`API_DOCS must be "true" or "false", got "${String(env.API_DOCS)}"`);
  }
  // Anyone holding it can pick their own rate-limit bucket on public routes, so it must not be guessable.
  const proxySecret = env.DASHBOARD_PROXY_SECRET;
  if (typeof proxySecret === 'string' && proxySecret !== '' && proxySecret.length < 32) {
    throw new Error('DASHBOARD_PROXY_SECRET must be at least 32 characters');
  }
  return env;
}
