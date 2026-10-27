// Fixture optional module that needs no tenant configuration.
import { Module } from '@nestjs/common';

class WebhooksModule {}
Module({})(WebhooksModule);

export default { key: 'webhooks', module: WebhooksModule };
