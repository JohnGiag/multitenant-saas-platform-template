import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/env.validation.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AuthGuard } from './modules/auth/presentation/auth.guard.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { RateLimitGuard } from './modules/rate-limit/presentation/rate-limit.guard.js';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module.js';
import type { OptionalModule } from './modules/system/domain/optional-module.js';
import { SystemModule } from './modules/system/system.module.js';
import { TenantContextGuard } from './modules/tenancy/presentation/tenant-context.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';

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
        AuthModule,
        RateLimitModule,
        TenancyModule,
        IntegrationsModule,
        JobsModule,
        NotificationsModule,
        SystemModule.register(optionalModules),
        ...optionalModules.map((m) => m.module),
      ],
      // The request pipeline, in this order: who is calling, are they over their limit, which tenant.
      // Guards, not interceptors: they all finish before a handler or SSE stream starts.
      providers: [
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useExisting: RateLimitGuard },
        { provide: APP_GUARD, useExisting: TenantContextGuard },
      ],
    };
  }
}
