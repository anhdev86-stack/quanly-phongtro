'use client';

import type { VietQrDto } from '@ql-tro/shared';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { formatVnd } from '@/lib/format';

/** Vẽ QR từ payload ngay trên trình duyệt (không gửi dữ liệu ra dịch vụ ngoài — MASTER_PLAN 9.6). */
export function QrImage({ payload, size = 220 }: { payload: string; size?: number }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    void QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: size }).then((s) => {
      if (alive) setSvg(s);
    });
    return () => {
      alive = false;
    };
  }, [payload, size]);
  return <div role="img" aria-label="Mã VietQR" className="shrink-0 bg-white" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** QR kèm thông tin chuyển khoản để khách chuyển tay nếu không quét được. */
export function QrTransferInfo({ qr, size }: { qr: VietQrDto; size?: number }) {
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
      <QrImage payload={qr.payload} size={size} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">Ngân hàng</dt>
        <dd className="font-medium">{qr.bank_name}</dd>
        <dt className="text-slate-500">Số tài khoản</dt>
        <dd className="font-medium tabular">{qr.account_number}</dd>
        <dt className="text-slate-500">Chủ tài khoản</dt>
        <dd className="font-medium">{qr.account_name}</dd>
        <dt className="text-slate-500">Số tiền</dt>
        <dd className="font-semibold tabular">{formatVnd(qr.amount_vnd)}</dd>
        <dt className="text-slate-500">Nội dung</dt>
        <dd className="font-medium tabular">{qr.content}</dd>
        {qr.is_demo ? (
          <dd className="col-span-2 mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Tài khoản demo — không chuyển tiền thật. Cấu hình tài khoản thật ở Cấu hình → Tài khoản nhận tiền.</dd>
        ) : null}
      </dl>
    </div>
  );
}
