// Modules that keep a tenant's data outside its own rows (files in a bucket, queued jobs) register here
// to erase it when the tenant is deleted. Hooks run before the rows go: one that throws aborts the
// deletion so it can be retried, so every hook must be safe to run twice.
export type TenantDeletionHook = (tenantId: string) => Promise<void>;

export class TenantDeletionHooks {
  private readonly hooks: TenantDeletionHook[] = [];

  register(hook: TenantDeletionHook): void {
    this.hooks.push(hook);
  }

  async run(tenantId: string): Promise<void> {
    for (const hook of this.hooks) await hook(tenantId);
  }
}
