// Without the secret the API sees every browser as this dashboard's own address, so 100 bad sign-ins per minute
// from one person would block everybody's. Exit rather than throw: a throw here only makes Next.js answer 500 to
// every request while the process keeps running.
if (process.env.NODE_ENV === 'production' && !process.env.DASHBOARD_PROXY_SECRET) {
  console.error("DASHBOARD_PROXY_SECRET is required in production: the API's value, the same one (32+ characters)");
  process.exit(1);
}

export {};
