// Fixture: a soft and a hard meter, and routes that spend them (usage.e2e).
import { Body, Controller, Module, Post } from '@nestjs/common';
import { Roles } from '../../../../dist/modules/auth/presentation/decorators.js';
import { RateLimitBudget } from '../../../../dist/modules/rate-limit/presentation/rate-limit-budget.js';
import { UsageMeter } from '../../../../dist/modules/usage/domain/usage-meter.js';
import { EnforceQuota } from '../../../../dist/modules/usage/presentation/enforce-quota.js';
import { TenantId } from '../../../../dist/modules/tenancy/presentation/tenant-context.js';

class MeteredController {
  constructor(usage) {
    this.usage = usage;
  }
  async soft(tenantId) {
    await this.usage.record(tenantId, 'soft_units');
    return { ok: true };
  }
  async hard(tenantId) {
    await this.usage.record(tenantId, 'hard_units');
    return { ok: true };
  }
  async batch(tenantId, body) {
    await this.usage.record(tenantId, 'hard_units', body.items.length);
    return { ok: true };
  }
}
Reflect.defineMetadata('design:paramtypes', [UsageMeter], MeteredController);

function route(name, ...decorators) {
  const descriptor = Object.getOwnPropertyDescriptor(MeteredController.prototype, name);
  for (const decorate of decorators) decorate(MeteredController.prototype, name, descriptor);
  TenantId()(MeteredController.prototype, name, 0);
}

const admins = Roles('TenantAdmin');
route('soft', Post('soft'), admins);
route('hard', Post('hard'), admins, EnforceQuota('hard_units'));
// A request costs and spends one unit per item.
const size = (body) => body?.items?.length;
const budget = RateLimitBudget({ name: 'batch', limits: { free: 10, pro: 10, enterprise: 10 }, cost: size });
route('batch', Post('batch'), admins, budget, EnforceQuota('hard_units', size));
Body()(MeteredController.prototype, 'batch', 1);
Controller('metered')(MeteredController);

class MeteredModule {}
Module({ controllers: [MeteredController] })(MeteredModule);

export default {
  key: 'metered',
  meters: [
    { key: 'soft_units', quotas: { free: { limit: 10, hard: false }, pro: null, enterprise: null } },
    { key: 'hard_units', quotas: { free: { limit: 3, hard: true }, pro: { limit: 100, hard: true }, enterprise: null } },
  ],
  module: MeteredModule,
};
