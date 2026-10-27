// Fixture optional module configured through the "fcm" integration.
import { Module } from '@nestjs/common';

class PushModule {}
Module({})(PushModule);

export default { key: 'push', integration: 'fcm', module: PushModule };
