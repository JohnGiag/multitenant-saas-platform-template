import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sendWithResend } from '../../../infrastructure/email/resend.js';
import {
  MailDeliveryError,
  MailNotConfiguredError,
  type SystemMail,
  type SystemMailer,
} from '../domain/ports/system-mailer.js';

// Resend's shared sender: it only delivers to the Resend account owner and Resend's test addresses.
// Set RESEND_PLATFORM_FROM to an address on a domain verified in Resend for real use.
const DEFAULT_PLATFORM_FROM = 'onboarding@resend.dev';

@Injectable()
export class ResendSystemMailer implements SystemMailer {
  constructor(private readonly config: ConfigService) {}

  async send({ to, subject, text }: SystemMail): Promise<string> {
    const apiKey = this.config.get<string>('RESEND_PLATFORM_KEY');
    if (!apiKey) throw new MailNotConfiguredError('No email credentials: set RESEND_PLATFORM_KEY');
    const from = this.config.get<string>('RESEND_PLATFORM_FROM') || DEFAULT_PLATFORM_FROM;
    const result = await sendWithResend({ apiKey, from, to, subject, text });
    if (!result.ok) throw new MailDeliveryError(result.detail);
    return result.id;
  }
}
