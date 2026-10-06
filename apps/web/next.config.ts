import type { NextConfig } from 'next';

// Trình duyệt chỉ nói chuyện với origin của web; /api/* được chuyển tiếp sang API (MASTER_PLAN 3.5).
const apiOrigin = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // E2E chạy một Next dev thứ hai song song với dev thường: dùng thư mục build riêng để không tranh khóa.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
