import type { Metadata } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Quản lý nhà trọ', template: '%s · Quản lý nhà trọ' },
  description: 'Phần mềm quản lý nhà trọ',
};

// Phông thiết kế cho tiếng Việt (dấu rõ, đều nét). next/font tự lưu tệp phông cùng ứng dụng: trình duyệt không gọi Google Fonts.
const appFont = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-app',
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={appFont.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
