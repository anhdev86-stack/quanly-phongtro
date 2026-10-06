import type { Metadata } from 'next';
import { PublicInvoiceView } from './view';

// Trang công khai qua link: không lập chỉ mục, không cache (MASTER_PLAN 9.6).
export const metadata: Metadata = {
  title: 'Thông báo tiền phòng',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicInvoiceView token={token} />;
}
