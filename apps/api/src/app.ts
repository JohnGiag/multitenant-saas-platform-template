import type { NestApplicationOptions } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { applyTrustProxy } from './common/trust-proxy.js';
import { loadOptionalModules } from './modules/system/infrastructure/optional-module-loader.js';

// Shared by main.ts and the tests. `optionalModulesDir` lets tests install fixture modules.
export async function createApp({ optionalModulesDir, ...options }: NestApplicationOptions & { optionalModulesDir?: string } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(await loadOptionalModules(optionalModulesDir)),
    // Open SSE streams never end on their own; without this, shutdown waits for them forever.
    { forceCloseConnections: true, ...options },
  );
  app.setGlobalPrefix('v1');
  applyTrustProxy(app, app.get(ConfigService).get<string>('TRUST_PROXY_HOPS', '0'));
  return app;
}
