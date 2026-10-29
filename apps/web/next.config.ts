import { join } from 'node:path';
import type { NextConfig } from 'next';

// The Docker image (apps/web/Dockerfile) builds a self-contained server; `next start` keeps the regular output.
const standalone = process.env.NEXT_OUTPUT === 'standalone';

const nextConfig: NextConfig = {
  // The API is called only from the server, so no API origin or token ever reaches the browser.
  poweredByHeader: false,
  // The e2e tests build a local-mode copy without Clerk keys into .next-e2e, so .next keeps the deployment's build.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // From the repository root, so the traced files include the workspace's packages (@repo/shared-types).
  ...(standalone && { output: 'standalone', outputFileTracingRoot: join(import.meta.dirname, '../..') }),
};

export default nextConfig;
