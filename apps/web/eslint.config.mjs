import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'next-env.d.ts', 'out/**']),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // MASTER_PLAN 3.4: web chỉ import @ql-tro/shared, không bao giờ import code của api hay Prisma.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/api/**', '@ql-tro/api', '@ql-tro/api/*', '@prisma/*'],
              message: 'apps/web chỉ được import @ql-tro/shared (MASTER_PLAN 3.4).',
            },
          ],
        },
      ],
    },
  },
]);
