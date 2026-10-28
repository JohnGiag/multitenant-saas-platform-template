import type { NestApplicationOptions } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { applyTrustProxy } from './common/trust-proxy.js';
import { loadOptionalModules } from './modules/system/infrastructure/optional-module-loader.js';
import { setupApiDocs } from './modules/system/presentation/api-docs.js';

// Shared by main.ts and the tests. `optionalModulesDir` lets tests install fixture modules.
export async function createApp({ optionalModulesDir, ...options }: NestApplicationOptions & { optionalModulesDir?: string } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(await loadOptionalModules(optionalModulesDir)),
    // forceCloseConnections: open SSE streams never end on their own, so shutdown would wait forever.
    // rawBody: webhook signatures (Clerk) cover the exact bytes received, not the parsed JSON.
    { forceCloseConnections: true, rawBody: true, ...options },
  );
  app.setGlobalPrefix('v1');
  const config = app.get(ConfigService);
  applyTrustProxy(app, config.get<string>('TRUST_PROXY_HOPS', '0'));
  // API reference at /docs: on unless NODE_ENV=production, where API_DOCS=true turns it on.
  if (config.get<string>('API_DOCS', process.env.NODE_ENV === 'production' ? 'false' : 'true') === 'true') {
    try {
      setupApiDocs(app);
    } catch (error) {
      // An undocumented route: fail the boot, but close first, or open queue connections keep the process alive.
      await app.close();
      throw error;
    }
  }
  return app;
}
