export const SYSTEM_MAILER = Symbol('SystemMailer');

// An email the platform itself sends (invitations, password resets), as opposed to notifications.
// Always sent with the platform's credentials, never a tenant's: these emails carry single-use links,
// and whoever controls the sending account can read them in its logs.
export interface SystemMail {
  to: string;
  subject: string;
  text: string;
}

export interface SystemMailer {
  // Resolves to the provider's message id; throws MailNotConfiguredError or MailDeliveryError.
  send(mail: SystemMail): Promise<string>;
}

// No credentials to send with (and never a fallback that would show the link to someone else).
export class MailNotConfiguredError extends Error {
  override name = 'MailNotConfiguredError';
}

export class MailDeliveryError extends Error {
  override name = 'MailDeliveryError';
}
