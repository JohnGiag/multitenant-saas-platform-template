import assert from 'node:assert/strict';
import { test } from 'node:test';
import { negotiateLocale, translator } from './translate.ts';

test('fills placeholders, and shows a missing key as itself', () => {
  const t = translator({ hello: 'Hello {name}, {name}!', json: 'e.g. {"apiKey": "…"}' });
  assert.equal(t('hello', { name: 'Ada' }), 'Hello Ada, Ada!');
  assert.equal(t('hello'), 'Hello {name}, {name}!');
  assert.equal(t('json'), 'e.g. {"apiKey": "…"}');
  assert.equal(t('nav.nowhere'), 'nav.nowhere');
});

test('picks the most preferred offered language from Accept-Language', () => {
  assert.equal(negotiateLocale('el-GR,el;q=0.9,en;q=0.8'), 'el');
  assert.equal(negotiateLocale('fr-FR,fr;q=0.9,el;q=0.5,en;q=0.4'), 'el');
  assert.equal(negotiateLocale('en;q=0.5,el;q=0.8'), 'el');
  assert.equal(negotiateLocale('EN-us'), 'en');
  // q=0 means "not this one".
  assert.equal(negotiateLocale('el;q=0,de'), 'en');
  assert.equal(negotiateLocale('de,fr'), 'en');
  assert.equal(negotiateLocale(undefined), 'en');
  assert.equal(negotiateLocale('*'), 'en');
});
