import { randomBytes } from 'node:crypto';
import {
  IdSchema,
  RoleSchema,
  TenantTierSchema,
  type AuthToken,
  type Principal,
  type SignInDto,
  type TenantChoice,
} from '@repo/shared-types';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { MAX_ACCOUNTS_PER_EMAIL } from '../domain/account-lookup.js';
import type { AuthService } from '../domain/ports/auth.port.js';
import { hashPassword, verifyPassword } from './password.js';

const ISSUER = 'enterprise-api-starter';
// shortcut: no refresh tokens or server-side revocation; role/tier changes apply when the token expires.
const TOKEN_TTL_SECONDS = 15 * 60;

const ClaimsSchema = z.object({ sub: IdSchema, tid: IdSchema, role: RoleSchema, tier: TenantTierSchema });

export class LocalAuthAdapter implements AuthService {
  private readonly key: Uint8Array;
  // Verified against when the user does not exist, so timing does not reveal registered emails.
  private readonly dummyHash = hashPassword(randomBytes(16).toString('hex'));

  constructor(
    private readonly prisma: PrismaService,
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
    const accessToken = await new SignJWT({ tid: user.tenantId, role: user.role, tier: user.tenant.tier })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
    return { accessToken, expiresIn: TOKEN_TTL_SECONDS };
  }

  async verifyAccessToken(token: string): Promise<Principal | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ['HS256'] });
      const claims = ClaimsSchema.safeParse(payload);
      if (!claims.success) return null;
      const { sub, tid, role, tier } = claims.data;
      return { kind: 'user', id: sub, tenantId: tid, role, tier };
    } catch {
      return null;
    }
  }
}
