// Fixture: two folders declaring the same key must stop startup.
import { Module } from '@nestjs/common';

class SecondModule {}
Module({})(SecondModule);

export default { key: 'dup', module: SecondModule };
