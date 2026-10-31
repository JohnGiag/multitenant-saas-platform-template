// Fixture: flags for each default (a tier, everyone, nobody), and routes gated by them (feature-flags.e2e).
import { Controller, Get, Module, Sse } from '@nestjs/common';
import { of } from 'rxjs';
import { Roles } from '../../../../dist/modules/auth/presentation/decorators.js';
import { RequireFeature } from '../../../../dist/modules/feature-flags/presentation/require-feature.js';

class GatedController {
  streaks() {
    return { ok: true };
  }
  business() {
    return { ok: true };
  }
  stream() {
    return of({ data: 'started' });
  }
  typo() {
    return { ok: true };
  }
}

function route(name, ...decorators) {
  const descriptor = Object.getOwnPropertyDescriptor(GatedController.prototype, name);
  for (const decorate of decorators) decorate(GatedController.prototype, name, descriptor);
}

const anyone = Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor');
route('streaks', Get('streaks'), anyone, RequireFeature('streaks'));
// Business data: its @Roles leave SuperAdmin out, and the flag being on must not let it in.
route('business', Get('business'), Roles('TenantAdmin'), RequireFeature('everyone'));
route('stream', Sse('stream'), anyone, RequireFeature('streaks'));
route('typo', Get('typo'), anyone, RequireFeature('no-such-flag'));
Controller('gated')(GatedController);

class GatedModule {}
Module({ controllers: [GatedController] })(GatedModule);

export default {
  key: 'gated',
  featureFlags: [
    { key: 'streaks', minTier: 'pro' },
    { key: 'everyone', minTier: 'free' },
    { key: 'private-beta', minTier: null },
  ],
  module: GatedModule,
};
