import path from 'node:path';
import { defineConfig, env } from 'prisma/config';
import { loadEnv } from './src/config/load-env.js';

loadEnv();

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed/index.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
