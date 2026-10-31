import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  IdSchema,
  RoleSchema,
  TenantTierSchema,
  type AuthToken,
  type Principal,
  type Role,
  type SignInDto,
  type TenantChoice,
  type TenantTier,
} from '@repo/shared-types';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { MAX_ACCOUNTS_PER_EMAIL } from '../domain/account-lookup.js';
import type { AccessRevocations } from '../domain/ports/access-revocations.port.js';
import type { AuthService } from '../domain/ports/auth.port.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  decideRefresh,
  parseRefreshToken,
  REFRESH_TOKEN_TTL_SECONDS,
  signRefreshToken,
} from '../domain/refresh-token.js';
import { hashPassword, verifyPassword } from './password.js';

const ISSUER = 'enterprise-api-starter';

// `sid` ties the token to its session and `at` is when it was issued in milliseconds (`iat` has only seconds, too
// coarse to tell a token from a revocation in the same second): both are for AccessRevocations.
const ClaimsSchema = z.object({
  sub: IdSchema,
  tid: IdSchema,
  sid: IdSchema,
  at: z.number().int(),
  role: RoleSchema,
  tier: TenantTierSchema,
});

const refreshExpiry = (now: Date) => new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);

interface TokenSubject {
  userId: string;
  tenantId: string;
  sessionId: string;
  generation: number;
  role: Role;
  tier: TenantTier;
}

export class LocalAuthAdapter implements AuthService {
  private readonly logger = new Logger('LocalAuth');
  private readonly key: Uint8Array;
  // Verified against when the user does not exist, so timing does not reveal registered emails.
  private readonly dummyHash = hashPassword(randomBytes(16).toString('hex'));

  constructor(
    private readonly prisma: PrismaService,
    private readonly revocations: AccessRevocations,
    jwtSecret: string,
  ) {
    if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
    this.key = new TextEncoder().encode(jwtSecret);
  }

  async signIn({ tenantId, email, password }: SignInDto): Promise<AuthToken | TenantChoice | null> {
    // Without a tenantId this looks across tenants (see MAX_ACCOUNTS_PER_EMAIL). Accounts that sign in
    // through an external provider have no password and are skipped.
    const accounts = await this.prisma.user.findMany({
      where: { email, passwordHash: { not: null }, ...(tenantId && { tenantId }) },
      orderBy: { id: 'asc' },
      take: MAX_ACCOUNTS_PER_EMAIL,
      select: { id: true, tenantId: true, role: true, passwordHash: true, tenant: { select: { name: true, tier: true } } },
    });
    if (accounts.length === 0) {
      await verifyPassword(await this.dummyHash, password);
      return null;
    }
    // In parallel, so the time barely depends on how many accounts the email has.
    const checks = await Promise.all(accounts.map((a) => verifyPassword(a.passwordHash!, password)));
    const matched = accounts.filter((_, i) => checks[i]);
    if (matched.length === 0) return null;
    if (matched.length > 1) return { tenants: matched.map((a) => ({ id: a.tenantId, name: a.tenant.name })) };

    const [user] = matched as [(typeof matched)[number]];
    const now = new Date();
    // Sessions left to expire are cleared here, so the table holds only live ones plus what a user left behind.
    await this.prisma.authSession.deleteMany({ where: { tenantId: user.tenantId, userId: user.id, expiresAt: { lte: now } } });
    const session = await this.prisma.authSession.create({
      data: { tenantId: user.tenantId, userId: user.id, expiresAt: refreshExpiry(now) },
      select: { id: true },
    });
    return this.issue({ userId: user.id, tenantId: user.tenantId, sessionId: session.id, generation: 0, role: user.role, tier: user.tenant.tier });
  }

  async refresh(refreshToken: string): Promise<AuthToken | null> {
    const claims = parseRefreshToken(this.key, refreshToken);
    if (!claims) return null;
    const where = { id: claims.sessionId, tenantId: claims.tenantId };
    const now = new Date();
    const session = await this.prisma.authSession.findFirst({
      where: { ...where, expiresAt: { gt: now } },
      select: { userId: true, generation: true, rotatedAt: true, user: { select: { role: true, tenant: { select: { tier: true } } } } },
    });
    if (!session) return null;

    const decision = decideRefresh(session, claims.generation, now);
    if (decision === 'reuse') {
      this.logger.warn(`Refresh token replayed for session ${claims.sessionId} of tenant ${claims.tenantId}: session ended`);
      await this.endSession(claims.tenantId, claims.sessionId);
      return null;
    }
    if (decision === 'rotate') {
      // Conditional: of parallel refreshes one advances the generation, and the rest derive the same token anyway.
      await this.prisma.authSession.updateMany({
        where: { ...where, generation: claims.generation },
        data: { generation: claims.generation + 1, rotatedAt: now, expiresAt: refreshExpiry(now) },
      });
    }
    // Role and tier are read again here, so a change reaches the session at its next refresh.
    return this.issue({
      userId: session.userId,
      tenantId: claims.tenantId,
      sessionId: claims.sessionId,
      generation: claims.generation + 1,
      role: session.user.role,
      tier: session.user.tenant.tier,
    });
  }

  async signOut(refreshToken: string): Promise<void> {
    const claims = parseRefreshToken(this.key, refreshToken);
    if (claims) await this.endSession(claims.tenantId, claims.sessionId);
  }

  async verifyAccessToken(token: string): Promise<Principal | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ['HS256'] });
      const claims = ClaimsSchema.safeParse(payload);
      if (!claims.success) return null;
      const { sub, tid, sid, at, role, tier } = claims.data;
      if (await this.revocations.isRevoked({ tenantId: tid, userId: sub, sessionId: sid, issuedAtMs: at })) return null;
      return { kind: 'user', id: sub, tenantId: tid, role, tier };
    } catch {
      return null;
    }
  }

  private async endSession(tenantId: string, sessionId: string): Promise<void> {
    await this.prisma.authSession.deleteMany({ where: { id: sessionId, tenantId } });
    await this.revocations.revoke('session', sessionId);
  }

  private async issue({ userId, tenantId, sessionId, generation, role, tier }: TokenSubject): Promise<AuthToken> {
    const accessToken = await new SignJWT({ tid: tenantId, sid: sessionId, at: Date.now(), role, tier })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: signRefreshToken(this.key, { tenantId, sessionId, generation }),
      refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
    };
  }
}
