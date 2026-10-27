import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../modules/integrations/integrations.module.js';
import { STORAGE_PROVIDER } from './domain/ports/storage-provider.js';
import { S3StorageProvider } from './infrastructure/s3-storage.provider.js';
import { StorageController } from './presentation/storage.controller.js';

@Module({
  imports: [IntegrationsModule],
  controllers: [StorageController],
  providers: [{ provide: STORAGE_PROVIDER, useClass: S3StorageProvider }],
})
export class StorageModule {}
