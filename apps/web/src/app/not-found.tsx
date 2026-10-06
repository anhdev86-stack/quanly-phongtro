import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Không tìm thấy trang</h1>
      <p className="text-sm text-slate-500">Đường dẫn không tồn tại hoặc chức năng chưa được triển khai.</p>
      <Link href="/" className="text-sm font-medium text-brand-700 hover:underline">
        Về trang tổng quan
      </Link>
    </main>
  );
}
