import type { ConfigService } from '@nestjs/config';

// The product's name where outsiders see it (webhook User-Agent, API reference title). Validated in env.validation.ts.
export const appName = (config: ConfigService): string => config.get<string>('APP_NAME') || 'enterprise-api-starter';
