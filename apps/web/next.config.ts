import path from 'node:path';
import type { NextConfig } from 'next';

// Trình duyệt chỉ nói chuyện với origin của web; /api/* được chuyển tiếp sang API (MASTER_PLAN 3.5).
// Với bản build `standalone` (Docker), giá trị này được chốt lúc build.
const apiOrigin = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // E2E chạy một Next dev thứ hai song song với dev thường: dùng thư mục build riêng để không tranh khóa.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Docker (Phase 9): NEXT_OUTPUT=standalone tạo server.js tự chứa; truy vết file từ gốc monorepo để kèm @ql-tro/shared.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const, outputFileTracingRoot: path.join(process.cwd(), '../..') } : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Link xem thông báo có token trong URL: không gửi Referer ra ngoài, không cache, không cho máy tìm kiếm lập chỉ mục.
      {
        source: '/p/:token*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
