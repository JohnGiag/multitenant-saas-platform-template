// Fixture: two modules declaring the same feature flag must stop startup.
import { Module } from '@nestjs/common';

class SecondModule {}
Module({})(SecondModule);

export default { key: 'second', featureFlags: [{ key: 'shared', minTier: 'pro' }], module: SecondModule };
