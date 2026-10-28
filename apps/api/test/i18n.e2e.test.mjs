import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { LOCALES, TranslationsSchema } from '@repo/shared-types';
import { cleanup, db, startApp } from './helpers.mjs';

// A key only English has, to see the fallback.
const ONLY_EN = `e2e.onlyEnglish.${crypto.randomUUID()}`;
let app, call;

before(async () => {
  await db.translation.create({ data: { locale: 'en', key: ONLY_EN, value: 'English only' } });
  ({ app, call } = await startApp());
});

after(async () => {
  await db.translation.deleteMany({ where: { key: ONLY_EN } });
  await cleanup(app, []);
});

async function messages(locale) {
  // No credentials: the sign-in pages need their text too.
  const res = await call('GET', `/translations/${locale}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(TranslationsSchema.parse(body), body, 'response does not match shared schema');
  assert.equal(body.locale, locale);
  return body.messages;
}

test('serves each language, publicly', async () => {
  assert.equal((await messages('en'))['common.signIn'], 'Sign in');
  assert.equal((await messages('el'))['common.signIn'], 'Σύνδεση');
});

test('every language has every English key, so none shows English by accident', async () => {
  const rows = await db.translation.findMany({ where: { key: { not: ONLY_EN } }, select: { locale: true, key: true } });
  const keys = (locale) => rows.filter((r) => r.locale === locale).map((r) => r.key).sort();
  assert.ok(keys('en').length > 0);
  for (const locale of LOCALES) assert.deepEqual(keys(locale), keys('en'), `${locale} differs from en`);
});

test('a key a language lacks falls back to English', async () => {
  assert.equal((await messages('el'))[ONLY_EN], 'English only');
});

test('rejects a language that is not offered', async () => {
  assert.equal((await call('GET', '/translations/fr')).status, 400);
});
