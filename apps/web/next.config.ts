import type { NextConfig } from 'next';

// Trình duyệt chỉ nói chuyện với origin của web; /api/* được chuyển tiếp sang API (MASTER_PLAN 3.5).
const apiOrigin = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
