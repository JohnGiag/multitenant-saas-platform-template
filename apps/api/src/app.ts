import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadOptionalModules } from './modules/system/infrastructure/optional-module-loader.js';

// Shared by main.ts and the tests. `optionalModulesDir` lets tests install fixture modules.
export async function createApp({ optionalModulesDir, ...options }: NestApplicationOptions & { optionalModulesDir?: string } = {}) {
  const app = await NestFactory.create(AppModule.register(await loadOptionalModules(optionalModulesDir)), options);
  app.setGlobalPrefix('v1');
  return app;
}
