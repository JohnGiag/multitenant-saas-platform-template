// An optional module whose route has no @ApiDoc: the OpenAPI document must refuse to build (openapi.e2e).
import { Controller, Get, Module } from '@nestjs/common';

class UndocumentedController {
  list() {
    return [];
  }
}
Get()(UndocumentedController.prototype, 'list', Object.getOwnPropertyDescriptor(UndocumentedController.prototype, 'list'));
Controller('undocumented')(UndocumentedController);

class UndocumentedModule {}
Module({ controllers: [UndocumentedController] })(UndocumentedModule);

export default { key: 'undocumented', module: UndocumentedModule };
