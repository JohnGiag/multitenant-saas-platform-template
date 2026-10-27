import { randomBytes } from 'node:crypto';
import {
  IdSchema,
  RoleSchema,
  TenantTierSchema,
  type AuthToken,
  type Principal,
  type SignInDto,
} from '@repo/shared-types';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
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

  async signIn({ tenantId, email, password }: SignInDto): Promise<AuthToken | null> {
    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { id: true, tenantId: true, role: true, passwordHash: true, tenant: { select: { tier: true } } },
    });
    const passwordOk = await verifyPassword(user?.passwordHash ?? (await this.dummyHash), password);
    if (!user?.passwordHash || !passwordOk) return null;

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
