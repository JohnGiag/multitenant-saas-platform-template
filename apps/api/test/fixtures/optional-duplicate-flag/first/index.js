// Fixture: two modules declaring the same feature flag must stop startup.
import { Module } from '@nestjs/common';

class FirstModule {}
Module({})(FirstModule);

export default { key: 'first', featureFlags: [{ key: 'shared', minTier: 'free' }], module: FirstModule };
