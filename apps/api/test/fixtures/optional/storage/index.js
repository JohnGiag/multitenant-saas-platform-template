// Fixture optional module that needs tenant configuration (the "r2" integration).
import { Module } from '@nestjs/common';

class StorageModule {}
Module({})(StorageModule);

export default { key: 'storage', integration: 'r2', module: StorageModule };
