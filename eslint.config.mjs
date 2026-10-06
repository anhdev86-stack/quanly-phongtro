// ESLint cho api, shared và e2e. apps/web có cấu hình riêng (eslint-config-next).
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'apps/web/**',
      'apps/api/src/generated/**',
      'e2e/playwright-report/**',
      'e2e/test-results/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Nest inject theo kiểu nhờ decorator metadata: import dùng trong constructor phải là import giá trị.
    // Báo cho rule consistent-type-imports để không đổi các import đó thành `import type`.
    files: ['apps/api/**/*.ts'],
    languageOptions: { parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true } },
  },
  {
    // MASTER_PLAN 3.4: domain/ là hàm thuần, không phụ thuộc framework, Prisma hay hạ tầng.
    files: ['apps/api/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', '@prisma/*', 'pg', 'express', '**/generated/**', '**/modules/**', '**/infrastructure/**', '**/common/**', '**/config/**'],
              message: 'apps/api/src/domain chỉ chứa hàm thuần: không import Nest, Prisma hay lớp hạ tầng (MASTER_PLAN 3.4).',
            },
          ],
        },
      ],
    },
  },
  {
    // Gói dùng chung không được kéo framework server hay code của app vào web.
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', '@prisma/*', 'pg', 'express', '**/apps/**', 'node:*'],
              message: '@ql-tro/shared chỉ chứa Zod schema, enum và hằng số dùng được ở cả api và web.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/shared/**/*.test.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Seed và script CLI được phép in ra console.
    files: ['apps/api/prisma/seed/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.ts', 'apps/api/test/**/*.ts', 'e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
