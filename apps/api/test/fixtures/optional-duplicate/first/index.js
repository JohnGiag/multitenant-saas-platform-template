// Fixture: two folders declaring the same key must stop startup.
import { Module } from '@nestjs/common';

class FirstModule {}
Module({})(FirstModule);

export default { key: 'dup', module: FirstModule };
