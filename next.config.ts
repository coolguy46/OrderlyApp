import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }, {
      source: '/api/:path*',
      headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
    }, {
      source: '/auth/:path*',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    }];
  },
};

export default nextConfig;
