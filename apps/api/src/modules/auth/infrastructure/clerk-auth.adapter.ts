import type { AuthToken, Principal } from '@repo/shared-types';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import type { AuthService } from '../domain/ports/auth.port.js';

// Clerk session token, version 2: `sub` is the Clerk user, `o` the active Organization (absent when none).
const ClaimsSchema = z.object({
  sub: z.string().min(1),
  azp: z.string().optional(),
  o: z.object({ id: z.string().min(1) }).optional(),
});

// Tenants are Clerk Organizations and members are Clerk users, both mirrored by the Clerk webhooks.
// The token says who and which organization; role and tier always come from our database.
export class ClerkAuthAdapter implements AuthService {
  private readonly issuer: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly prisma: PrismaService,
    issuer: string,
    private readonly authorizedParties: string[],
  ) {
    // Clerk's `iss` is the Frontend API URL exactly, without a trailing slash.
    this.issuer = issuer.replace(/\/+$/, '');
    // Fetched and cached by jose; refetched when Clerk rotates its signing key.
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
  }

  // Clerk users sign in through Clerk's own UI, never through this API.
  async signIn(): Promise<AuthToken | null> {
    return null;
  }

  // Clerk keeps its own sessions; these routes answer 409 in Clerk mode (@LocalAuthOnly).
  async refresh(): Promise<AuthToken | null> {
    return null;
  }

  async signOut(): Promise<void> {}

  async verifyAccessToken(token: string): Promise<Principal | null> {
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, { issuer: this.issuer, algorithms: ['RS256'] }));
    } catch {
      return null;
    }
    const claims = ClaimsSchema.safeParse(payload);
    if (!claims.success) return null;
    const { sub, azp, o } = claims.data;
    // A token Clerk issued to another site is not ours to accept.
    if (azp && this.authorizedParties.length > 0 && !this.authorizedParties.includes(azp)) return null;
    // Without an active Organization there is no tenant to act in.
    if (!o) return null;

    // shortcut: one indexed query per request to map Clerk ids to our member; cache briefly if it shows in latency.
    const user = await this.prisma.user.findFirst({
      where: { clerkUserId: sub, tenant: { clerkOrgId: o.id } },
      select: { id: true, tenantId: true, role: true, tenant: { select: { tier: true } } },
    });
    if (!user) return null;
    return { kind: 'user', id: user.id, tenantId: user.tenantId, role: user.role, tier: user.tenant.tier };
  }
}
