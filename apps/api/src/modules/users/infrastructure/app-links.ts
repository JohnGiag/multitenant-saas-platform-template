import type { ConfigService } from '@nestjs/config';
import { MailNotConfiguredError } from '../../mail/domain/ports/system-mailer.js';

// Links in emails point at the dashboard (APP_URL), which posts the token back to the API.
// `page` is relative to APP_URL, so a dashboard under a path (https://example.com/app) keeps it.
export function appLink(config: Pick<ConfigService, 'get'>, page: string, token: string): string {
  const base = config.get<string>('APP_URL');
  if (!base) throw new MailNotConfiguredError('APP_URL is not set, so emails cannot link to the dashboard');
  const url = new URL(page, base.endsWith('/') ? base : `${base}/`);
  url.searchParams.set('token', token);
  return url.toString();
}
