import { defineConfig } from 'vitest/config';

// Nest cần decorator metadata (design:paramtypes) để inject theo kiểu.
// Vite 8 dùng Oxc: bật legacy decorator + emitDecoratorMetadata (thay cho SWC, xem DECISIONS D-004).
export const oxc = {
  decorator: { legacy: true, emitDecoratorMetadata: true },
};

export default defineConfig({
  oxc,
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
