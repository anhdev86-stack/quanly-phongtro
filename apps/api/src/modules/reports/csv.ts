/**
 * CSV cho Excel tiếng Việt: UTF-8 có BOM, phân cách dấu phẩy, bọc ngoặc kép khi cần, xuống dòng CRLF.
 * Số tiền xuất dạng số nguyên (không dấu chấm ngăn cách) để Excel tính được.
 */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Chặn công thức Excel (=, +, @, hoặc - không phải số âm) bằng tiền tố ' .
    const formula = /^[=+@]/.test(s) || (/^-/.test(s) && !/^-\d+$/.test(s));
    const text = formula ? `'${s}` : s;
    return /[",\r\n]/.test(text) || formula ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
