import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The API is called only from the server, so no API origin or token ever reaches the browser.
  poweredByHeader: false,
};

export default nextConfig;
