import { Module } from '@nestjs/common';
import { INTEGRATION_SERVICE } from './domain/ports/integration.service.js';
import { PrismaIntegrationService } from './infrastructure/prisma-integration.service.js';
import { IntegrationsController } from './presentation/integrations.controller.js';

@Module({
  controllers: [IntegrationsController],
  providers: [{ provide: INTEGRATION_SERVICE, useClass: PrismaIntegrationService }],
  // Other modules (email, storage, push) read tenant secrets through INTEGRATION_SERVICE.
  exports: [INTEGRATION_SERVICE],
})
export class IntegrationsModule {}
