import { Global, Module } from '@nestjs/common';
import { OPTIONAL_MODULES, type OptionalModule } from '../system/domain/optional-module.js';
import { FeatureFlags } from './domain/feature-flags.js';
import { FEATURE_FLAG_REPOSITORY, type FeatureFlagRepository } from './domain/ports/feature-flag.repository.js';
import { PrismaFeatureFlagRepository } from './infrastructure/prisma-feature-flag.repository.js';
import { FeatureFlagsController } from './presentation/feature-flags.controller.js';

// Global, like TenantEvents: any module may use @RequireFeature without importing this one.
@Global()
@Module({
  controllers: [FeatureFlagsController],
  providers: [
    { provide: FEATURE_FLAG_REPOSITORY, useClass: PrismaFeatureFlagRepository },
    {
      provide: FeatureFlags,
      inject: [OPTIONAL_MODULES, FEATURE_FLAG_REPOSITORY],
      useFactory: (modules: OptionalModule[], repository: FeatureFlagRepository) =>
        new FeatureFlags(modules.flatMap((m) => m.featureFlags ?? []), repository),
    },
  ],
  exports: [FeatureFlags],
})
export class FeatureFlagsModule {}
