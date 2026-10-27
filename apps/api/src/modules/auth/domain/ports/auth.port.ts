import type { AuthToken, Principal, SignInDto } from '@repo/shared-types';

export const AUTH_SERVICE = Symbol('AuthService');

// Identity provider port. Local (JWT + Argon2id) and Clerk adapters implement it.
export interface AuthService {
  // Returns null for wrong credentials, or when the provider has no API sign-in (Clerk).
  signIn(input: SignInDto): Promise<AuthToken | null>;
  // Returns null for any invalid, expired or foreign token. Never throws for bad input.
  verifyAccessToken(token: string): Promise<Principal | null>;
}
