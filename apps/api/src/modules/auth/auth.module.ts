import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { API_KEY_SERVICE } from './domain/ports/api-key.port.js';
import { AUTH_SERVICE, type AuthService } from './domain/ports/auth.port.js';
import { ClerkAuthAdapter } from './infrastructure/clerk-auth.adapter.js';
import { LocalAuthAdapter } from './infrastructure/local-auth.adapter.js';
import { PrismaApiKeyService } from './infrastructure/prisma-api-key.service.js';
import { ApiKeysController } from './presentation/api-keys.controller.js';
import { AuthController } from './presentation/auth.controller.js';
import { AuthGuard } from './presentation/auth.guard.js';

// AUTH_PROVIDER is already validated at boot (config/env.validation.ts).
function createAuthService(config: ConfigService, prisma: PrismaService): AuthService {
  if (config.get<string>('AUTH_PROVIDER') === 'clerk') {
    new Logger('AuthModule').warn('Clerk adapter is a stub: every bearer token is rejected');
    return new ClerkAuthAdapter();
  }
  return new LocalAuthAdapter(prisma, config.getOrThrow<string>('JWT_SECRET'));
}

@Module({
  imports: [RateLimitModule],
  controllers: [AuthController, ApiKeysController],
  providers: [
    { provide: AUTH_SERVICE, inject: [ConfigService, PrismaService], useFactory: createAuthService },
    { provide: API_KEY_SERVICE, useClass: PrismaApiKeyService },
    AuthGuard,
  ],
  // Registered globally by AppModule, first in the guard chain.
  exports: [AuthGuard],
})
export class AuthModule {}
