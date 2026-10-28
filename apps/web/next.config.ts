import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The API is called only from the server, so no API origin or token ever reaches the browser.
  poweredByHeader: false,
  // The e2e tests build a local-mode copy without Clerk keys into .next-e2e, so .next keeps the deployment's build.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
