// AUTH_PROVIDER, the same value as the API's: "local" (our sign-in form, JWT in an httpOnly cookie) or "clerk"
// (Clerk's components and session). Server-side only: it has no NEXT_PUBLIC_ prefix, so pass it down as a prop.
export function parseAuthProvider(raw: string | undefined): 'local' | 'clerk' {
  const provider = raw || 'local';
  if (provider !== 'local' && provider !== 'clerk') {
    throw new Error(`Unknown AUTH_PROVIDER "${provider}" (expected "local" or "clerk")`);
  }
  return provider;
}

export const CLERK = parseAuthProvider(process.env.AUTH_PROVIDER) === 'clerk';
