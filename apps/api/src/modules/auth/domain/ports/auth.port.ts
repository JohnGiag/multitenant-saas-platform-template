import type { AuthToken, Principal, SignInDto, TenantChoice } from '@repo/shared-types';

export const AUTH_SERVICE = Symbol('AuthService');

// Identity provider port. Local (JWT + Argon2id) and Clerk adapters implement it.
export interface AuthService {
  // A token, or a TenantChoice when the password matched accounts in several tenants and no tenantId picked
  // one. Null for wrong credentials, or when the provider has no API sign-in (Clerk).
  signIn(input: SignInDto): Promise<AuthToken | TenantChoice | null>;
  // A new token pair for a refresh token, which stops working. Null when it is invalid, expired or replayed (which
  // also ends the session), or when the provider manages its own sessions (Clerk).
  refresh(refreshToken: string): Promise<AuthToken | null>;
  // Ends the session the token belongs to; an invalid token does nothing.
  signOut(refreshToken: string): Promise<void>;
  // Returns null for any invalid, expired or foreign token. Never throws for bad input.
  verifyAccessToken(token: string): Promise<Principal | null>;
}
