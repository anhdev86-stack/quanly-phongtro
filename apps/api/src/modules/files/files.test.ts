import { describe, expect, it } from 'vitest';
import { safeName, sniffMime } from './files.service.js';

describe('tệp riêng tư: nhận diện định dạng theo nội dung', () => {
  it('nhận JPG/PNG/WEBP/PDF theo chữ ký, từ chối nội dung khác dù đuôi tệp là ảnh', () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp');
    expect(sniffMime(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffMime(Buffer.from('GIF89a'))).toBeNull();
  });

  it('tên tệp: bỏ đường dẫn và ký tự điều khiển, giữ tiếng Việt', () => {
    expect(safeName('..\\..\\windows\\cccd mặt trước.png')).toBe('cccd mặt trước.png');
    expect(safeName('a/b/"x"\u0000.pdf')).toBe('x.pdf');
    expect(safeName('   ')).toBe('tep');
  });
});
