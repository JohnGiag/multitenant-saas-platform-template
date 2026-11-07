// Fixture: a write marked @NotAudited() next to an ordinary one (audit.e2e).
import { Controller, Module, Post } from '@nestjs/common';
import { NotAudited } from '../../../../dist/modules/audit/presentation/audit.interceptor.js';
import { Roles } from '../../../../dist/modules/auth/presentation/decorators.js';

class SyncController {
  data() {
    return { ok: true };
  }
  change() {
    return { ok: true };
  }
}

function route(name, ...decorators) {
  const descriptor = Object.getOwnPropertyDescriptor(SyncController.prototype, name);
  for (const decorate of decorators) decorate(SyncController.prototype, name, descriptor);
}

route('data', Post('data'), Roles('TenantAdmin'), NotAudited());
route('change', Post('change'), Roles('TenantAdmin'));
Controller('sync')(SyncController);

class SyncModule {}
Module({ controllers: [SyncController] })(SyncModule);

export default { key: 'sync', module: SyncModule };
