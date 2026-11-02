import { Global, Module } from '@nestjs/common';
import { ApiScopes } from './domain/api-scopes.js';

// Global, like TenantEvents: any module may declare its scopes without importing the auth module.
@Global()
@Module({
  providers: [{ provide: ApiScopes, useFactory: () => new ApiScopes() }],
  exports: [ApiScopes],
})
export class ApiScopesModule {}
