import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module.js';
import type { OptionalModule } from './modules/system/domain/optional-module.js';
import { SystemModule } from './modules/system/system.module.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';

// Optional modules are discovered at startup (see createApp) and never imported here.
@Module({})
export class AppModule {
  static register(optionalModules: OptionalModule[]): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        RedisModule,
        AuthModule,
        RateLimitModule,
        TenancyModule,
        IntegrationsModule,
        SystemModule.register(optionalModules),
        ...optionalModules.map((m) => m.module),
      ],
    };
  }
}
