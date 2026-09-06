import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: '101mb',
    serverActions: {
      bodySizeLimit: '50mb'
    }
  }
};

export default nextConfig;
