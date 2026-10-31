import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localPath } from './session-page.ts';

test('paths on this site are kept, with their query', () => {
  assert.equal(localPath('/users?cursor=abc'), '/users?cursor=abc');
  assert.equal(localPath('/'), '/');
});

test('anything leading to another site goes home', () => {
  for (const next of ['https://evil.com/', '//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '/\r\n/evil.com', '/\t\\evil.com', 'javascript:alert(1)', 'http://']) {
    assert.equal(localPath(next), '/', JSON.stringify(next));
  }
});
