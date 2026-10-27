import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { MailDeliveryError, MailNotConfiguredError } from '../../mail/domain/ports/system-mailer.js';

// Turns a failed system email into an HTTP answer; anything else is rethrown untouched.
export function rethrowMailError(error: unknown): never {
  if (error instanceof MailNotConfiguredError) throw new ServiceUnavailableException('Email delivery is not configured');
  if (error instanceof MailDeliveryError) throw new BadGatewayException('The email could not be sent; try again');
  throw error;
}
