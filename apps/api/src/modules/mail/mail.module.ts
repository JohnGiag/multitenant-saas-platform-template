import { Module } from '@nestjs/common';
import { SYSTEM_MAILER } from './domain/ports/system-mailer.js';
import { ResendSystemMailer } from './infrastructure/resend-system-mailer.js';

// Core: emails the platform itself must send (invitations, password resets), with the platform's
// credentials, even when the optional email module is not installed.
@Module({
  providers: [{ provide: SYSTEM_MAILER, useClass: ResendSystemMailer }],
  exports: [SYSTEM_MAILER],
})
export class MailModule {}
