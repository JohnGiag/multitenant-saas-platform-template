import { parseProxyHops } from '@/lib/client-ip';

// Without the secret the API sees every browser as this dashboard's own address, so 100 bad sign-ins per minute
// from one person would block everybody's. Exit rather than throw: a throw here only makes Next.js answer 500 to
// every request while the process keeps running.
if (process.env.NODE_ENV === 'production' && !process.env.DASHBOARD_PROXY_SECRET) {
  console.error("DASHBOARD_PROXY_SECRET is required in production: the API's value, the same one (32+ characters)");
  process.exit(1);
}

// Same result with the secret set: no IP is forwarded at 0 hops. Only a warning, since 0 is right without a proxy.
if (process.env.NODE_ENV === 'production' && parseProxyHops(process.env.TRUST_PROXY_HOPS) === 0) {
  console.warn('TRUST_PROXY_HOPS is 0, so no browser IP reaches the API and every browser shares one rate-limit bucket. Behind a proxy, set it to the number of proxies');
}
