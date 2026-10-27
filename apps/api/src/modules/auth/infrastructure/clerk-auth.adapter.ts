import type { AuthToken, Principal } from '@repo/shared-types';
import type { AuthService } from '../domain/ports/auth.port.js';

// shortcut: stub that fails closed (rejects every token); implement with @clerk/backend verifyToken
// plus a Clerk org/user -> tenant/user mapping when Clerk is adopted.
export class ClerkAuthAdapter implements AuthService {
  // Clerk users sign in through Clerk's own UI, never through this API.
  async signIn(): Promise<AuthToken | null> {
    return null;
  }

  async verifyAccessToken(): Promise<Principal | null> {
    return null;
  }
}
