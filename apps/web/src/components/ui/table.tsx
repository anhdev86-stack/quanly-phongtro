'use client';

import { type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Bảng dữ liệu. Trên điện thoại (< 640px, `stack` mặc định bật) mỗi dòng hiện thành một thẻ, mỗi ô ghi tên cột bên trái — không phải
 * vuốt ngang. Tên cột lấy tự động từ tiêu đề (`data-label`); vai trò bảng/dòng/ô gán rõ để trình đọc màn hình vẫn đọc là bảng khi đổi bố cục.
 * Ô gộp nhiều cột (`colSpan`) hiện cả hàng (nhóm, dòng trống). Desktop và bản in giữ dạng bảng.
 */
export function Table({ className, stack = true, ...props }: HTMLAttributes<HTMLTableElement> & { stack?: boolean }) {
  const ref = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const table = ref.current;
    if (!table || !stack) return;
    const label = () => {
      const heads = [...table.querySelectorAll(':scope > thead > tr:last-child > th')].map((th) => (th.textContent ?? '').trim());
      table.querySelectorAll(':scope > thead, :scope > tbody, :scope > tfoot').forEach((g) => g.setAttribute('role', 'rowgroup'));
      table.querySelectorAll(':scope > thead > tr > th').forEach((th) => th.setAttribute('role', 'columnheader'));
      for (const tr of table.querySelectorAll(':scope > tbody > tr, :scope > tfoot > tr')) {
        tr.setAttribute('role', 'row');
        let col = 0;
        for (const cell of tr.children) {
          const span = Number(cell.getAttribute('colspan') ?? 1) || 1;
          cell.setAttribute('role', cell.tagName === 'TH' ? 'rowheader' : 'cell');
          if (span > 1) cell.setAttribute('data-full', '');
          else cell.removeAttribute('data-full');
          cell.setAttribute('data-label', span > 1 ? '' : (heads[col] ?? ''));
          col += span;
        }
      }
      table.querySelectorAll(':scope > thead > tr').forEach((tr) => tr.setAttribute('role', 'row'));
    };
    label();
    const observer = new MutationObserver(label);
    observer.observe(table, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [stack]);

  return (
    // `relative`: phần tử định vị tuyệt đối (VD tiêu đề sr-only) phải nằm trong khung cuộn, không làm trang rộng ra trên mobile.
    <div className="relative w-full overflow-x-auto">
      <table ref={ref} role="table" className={cn('w-full border-collapse text-sm', stack && 'table-stack', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('border-b border-sky-200 bg-sky-100/80 px-3 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-brand-800 uppercase', className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-slate-100 px-3 py-2.5 align-middle', className)} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-brand-50/40', className)} {...props} />;
}
