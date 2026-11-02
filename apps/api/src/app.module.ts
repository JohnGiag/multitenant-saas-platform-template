import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validateEnv } from './config/env.validation.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuditInterceptor } from './modules/audit/presentation/audit.interceptor.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ApiScopesModule } from './modules/auth/api-scopes.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { IdempotencyModule } from './modules/idempotency/idempotency.module.js';
import { IdempotencyGuard } from './modules/idempotency/presentation/idempotency.guard.js';
import { IdempotencyInterceptor } from './modules/idempotency/presentation/idempotency.interceptor.js';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module.js';
import { AccessGuard } from './modules/auth/presentation/access.guard.js';
import { AuthGuard } from './modules/auth/presentation/auth.guard.js';
import { I18nModule } from './modules/i18n/i18n.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { RateLimitGuard } from './modules/rate-limit/presentation/rate-limit.guard.js';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module.js';
import type { OptionalModule } from './modules/system/domain/optional-module.js';
import { SystemModule } from './modules/system/system.module.js';
import { TenantContextGuard } from './modules/tenancy/presentation/tenant-context.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';
import { UsersModule } from './modules/users/users.module.js';

// Optional modules are discovered at startup (see createApp) and never imported here.
@Module({})
export class AppModule {
  static register(optionalModules: OptionalModule[]): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        PrismaModule,
        RedisModule,
        EventsModule,
        ApiScopesModule,
        AuthModule,
        RateLimitModule,
        TenancyModule,
        IdempotencyModule,
        UsersModule,
        IntegrationsModule,
        JobsModule,
        NotificationsModule,
        AuditModule,
        I18nModule,
        FeatureFlagsModule,
        SystemModule.register(optionalModules),
        ...optionalModules.map((m) => m.module),
      ],
      // The request pipeline, in this order: who is calling, are they over their limit, may they call
      // this route, which tenant. Limiting before the access check also meters rejected credentials.
      // Guards, not interceptors: they all finish before a handler or SSE stream starts.
      providers: [
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useExisting: RateLimitGuard },
        { provide: APP_GUARD, useExisting: AccessGuard },
        { provide: APP_GUARD, useExisting: TenantContextGuard },
        { provide: APP_GUARD, useExisting: IdempotencyGuard },
        { provide: APP_INTERCEPTOR, useExisting: IdempotencyInterceptor },
        // Records successful writes; it never rejects, so it is an interceptor, not a guard.
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    };
  }
}
