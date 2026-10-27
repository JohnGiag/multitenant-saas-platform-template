// Fixture optional module configured through the "resend" integration.
import { Module } from '@nestjs/common';

class EmailModule {}
Module({})(EmailModule);

export default { key: 'email', integration: 'resend', module: EmailModule };
