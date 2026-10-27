// Opt-in, not part of `pnpm test`: sends one real email with RESEND_PLATFORM_KEY to Resend's
// delivered@resend.dev test address (nobody's inbox). With RESEND_PLATFORM_FULL_ACCESS_KEY (a separate full-access, dev-only
// key: the app's own key should stay send-only) it also asks Resend's API until the email reports
// "delivered". Touches no database. Run: pnpm --filter @repo/api test:live (after a build).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { ResendSystemMailer } from '../../dist/modules/mail/infrastructure/resend-system-mailer.js';

if (existsSync('.env')) process.loadEnvFile();
const { RESEND_PLATFORM_KEY, RESEND_PLATFORM_FULL_ACCESS_KEY } = process.env;
let emailId;

test('Resend accepts a platform email', { skip: !RESEND_PLATFORM_KEY && 'RESEND_PLATFORM_KEY is not set' }, async () => {
  // The real mailer with the real platform key.
  const mailer = new ResendSystemMailer({ get: (name) => process.env[name] });
  emailId = await mailer.send({
    to: 'delivered@resend.dev',
    subject: `Live check ${new Date().toISOString()}`,
    text: 'Sent by apps/api/test/live/resend.live.test.mjs',
  });
  assert.equal(typeof emailId, 'string');
});

test('Resend reports it delivered', { skip: !RESEND_PLATFORM_FULL_ACCESS_KEY && 'set RESEND_PLATFORM_FULL_ACCESS_KEY (full access) to check delivery' }, async () => {
  assert.ok(emailId, 'the send step did not run');
  let lastEvent;
  for (let attempt = 0; attempt < 30 && lastEvent !== 'delivered'; attempt++) {
    await sleep(2000);
    const res = await fetch(`https://api.resend.com/emails/${emailId}`, {
      headers: { authorization: `Bearer ${RESEND_PLATFORM_FULL_ACCESS_KEY}` },
    });
    assert.equal(res.status, 200, `Resend GET /emails/${emailId} answered ${res.status}: ${await res.clone().text()}`);
    lastEvent = (await res.json()).last_event;
  }
  assert.equal(lastEvent, 'delivered');
});
