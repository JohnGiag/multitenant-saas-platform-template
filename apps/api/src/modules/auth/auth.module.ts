import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { API_KEY_SERVICE } from './domain/ports/api-key.port.js';
import { AUTH_SERVICE, type AuthService } from './domain/ports/auth.port.js';
import { ClerkAuthAdapter } from './infrastructure/clerk-auth.adapter.js';
import { ClerkWebhookHandler } from './infrastructure/clerk-webhook.handler.js';
import { LocalAuthAdapter } from './infrastructure/local-auth.adapter.js';
import { PrismaApiKeyService } from './infrastructure/prisma-api-key.service.js';
import { AccessGuard } from './presentation/access.guard.js';
import { ApiKeysController } from './presentation/api-keys.controller.js';
import { AuthController } from './presentation/auth.controller.js';
import { AuthGuard } from './presentation/auth.guard.js';
import { ClerkWebhookController } from './presentation/clerk-webhook.controller.js';

// AUTH_PROVIDER and the Clerk settings are already validated at boot (config/env.validation.ts).
function createAuthService(config: ConfigService, prisma: PrismaService): AuthService {
  if (config.get<string>('AUTH_PROVIDER') !== 'clerk') {
    return new LocalAuthAdapter(prisma, config.getOrThrow<string>('JWT_SECRET'));
  }
  const parties = (config.get<string>('CLERK_AUTHORIZED_PARTIES') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (parties.length === 0) {
    new Logger('AuthModule').warn('CLERK_AUTHORIZED_PARTIES is not set: tokens are accepted from any origin');
  }
  return new ClerkAuthAdapter(prisma, config.getOrThrow<string>('CLERK_ISSUER'), parties);
}

@Module({
  imports: [RateLimitModule, TenancyModule],
  controllers: [AuthController, ApiKeysController, ClerkWebhookController],
  providers: [
    { provide: AUTH_SERVICE, inject: [ConfigService, PrismaService], useFactory: createAuthService },
    { provide: API_KEY_SERVICE, useClass: PrismaApiKeyService },
    ClerkWebhookHandler,
    AuthGuard,
    AccessGuard,
  ],
  // Registered globally by AppModule: AuthGuard first in the guard chain, AccessGuard after RateLimitGuard.
  exports: [AuthGuard, AccessGuard],
})
export class AuthModule {}
