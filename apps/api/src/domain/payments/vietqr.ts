/**
 * Payload VietQR (EMVCo QR + NAPAS 247, chuyển tới tài khoản) — MASTER_PLAN 9.6. Hàm thuần, không gọi dịch vụ ngoài.
 *
 * Cấu trúc TLV (ID 2 số + độ dài 2 số + giá trị):
 *   00 "01" · 01 "12" (QR động, có số tiền) · 38 thông tin người nhận [00 GUID A000000727, 01 [00 BIN, 01 số TK], 02 QRIBFTTA]
 *   53 "704" (VND) · 54 số tiền · 58 "VN" · 62 [08 nội dung] · 63 CRC16-CCITT-FALSE (0x1021, init 0xFFFF) trên toàn chuỗi gồm "6304".
 */
export interface VietQrInput {
  bankBin: string;
  accountNumber: string;
  amountVnd: bigint;
  content: string;
}

const NAPAS_GUID = 'A000000727';
const SERVICE_TO_ACCOUNT = 'QRIBFTTA';

function tlv(id: string, value: string): string {
  if (value.length > 99) throw new RangeError(`Trường ${id} quá dài.`);
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, không đảo bit; trả 4 ký tự hex chữ hoa. */
export function crc16(data: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(data)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Bỏ dấu tiếng Việt, chỉ giữ A–Z, 0–9, khoảng trắng và gạch; chữ hoa; tối đa `max` ký tự. */
export function toTransferText(text: string, max = 25): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** Nội dung chuyển khoản mặc định (MASTER_PLAN 2.2): `<mã thông báo> <mã phòng>`, không dấu, ≤ 25 ký tự. */
export function transferContent(invoiceNumber: string, roomCode: string): string {
  return toTransferText(`${invoiceNumber.replace(/-/g, '')} ${roomCode}`);
}

export function buildVietQr(input: VietQrInput): string {
  if (!/^\d{6}$/.test(input.bankBin)) throw new RangeError('Mã ngân hàng (BIN) gồm 6 chữ số.');
  if (!/^[0-9A-Za-z]{1,19}$/.test(input.accountNumber)) throw new RangeError('Số tài khoản không hợp lệ.');
  if (input.amountVnd <= 0n) throw new RangeError('Số tiền phải dương.');
  const beneficiary = tlv('00', input.bankBin) + tlv('01', input.accountNumber);
  const merchant = tlv('00', NAPAS_GUID) + tlv('01', beneficiary) + tlv('02', SERVICE_TO_ACCOUNT);
  const content = toTransferText(input.content);
  const body =
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('38', merchant) +
    tlv('53', '704') +
    tlv('54', input.amountVnd.toString()) +
    tlv('58', 'VN') +
    (content ? tlv('62', tlv('08', content)) : '') +
    '6304';
  return body + crc16(body);
}

/** Đọc lại TLV mức ngoài (dùng cho test và đối chiếu). */
export function parseTlv(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    out[id] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}
