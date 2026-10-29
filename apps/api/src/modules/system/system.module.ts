import { Module, type DynamicModule } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { OPTIONAL_MODULES, type OptionalModule } from './domain/optional-module.js';
import { CapabilitiesController } from './presentation/capabilities.controller.js';
import { HealthController } from './presentation/health.controller.js';

@Module({})
export class SystemModule {
  // Global so core modules (e.g. integrations) can read the registry without importing SystemModule,
  // which would be circular.
  static register(optionalModules: OptionalModule[]): DynamicModule {
    return {
      module: SystemModule,
      global: true,
      imports: [IntegrationsModule],
      controllers: [CapabilitiesController, HealthController],
      providers: [{ provide: OPTIONAL_MODULES, useValue: optionalModules }],
      exports: [OPTIONAL_MODULES],
    };
  }
}
