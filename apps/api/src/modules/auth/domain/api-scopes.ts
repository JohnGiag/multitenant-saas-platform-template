import { CORE_API_SCOPES } from '@repo/shared-types';

// The scopes an API key can hold. A module adds its own in onModuleInit, like event types in TenantEvents.
export class ApiScopes {
  private readonly scopes = new Set<string>(CORE_API_SCOPES);

  declare(...scopes: string[]): void {
    for (const scope of scopes) this.scopes.add(scope);
  }

  declared(): string[] {
    return [...this.scopes].sort();
  }
}
