import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientIpFrom, parseProxyHops } from './client-ip.ts';

test('the client IP is read only as far as our own proxies wrote it', () => {
  // One proxy appended the browser's address after whatever the browser claimed.
  assert.equal(clientIpFrom('6.6.6.6, 203.0.113.7', 1), '203.0.113.7');
  // CDN, then load balancer: the CDN wrote the browser, the load balancer wrote the CDN.
  assert.equal(clientIpFrom('6.6.6.6, 203.0.113.7, 10.0.0.2', 2), '203.0.113.7');
  assert.equal(clientIpFrom('2001:db8::1', 1), '2001:db8::1');
});

test('nothing is trusted without proxies, or when the header is short or not an IP', () => {
  assert.equal(clientIpFrom('203.0.113.7', 0), undefined);
  assert.equal(clientIpFrom(null, 1), undefined);
  assert.equal(clientIpFrom('203.0.113.7', 2), undefined);
  assert.equal(clientIpFrom('203.0.113.7:51234', 1), undefined);
  assert.equal(clientIpFrom('unknown', 1), undefined);
});

test('TRUST_PROXY_HOPS is a count, 0 when unset', () => {
  assert.equal(parseProxyHops(undefined), 0);
  assert.equal(parseProxyHops(''), 0);
  assert.equal(parseProxyHops('2'), 2);
  for (const bad of ['-1', '1.5', 'true', '10.0.0.1']) assert.throws(() => parseProxyHops(bad), /TRUST_PROXY_HOPS/, bad);
});
