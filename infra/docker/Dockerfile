# syntax=docker/dockerfile:1
# Một Dockerfile, ba target (RUNBOOK.md):
#   migrate — có đủ công cụ: `prisma migrate deploy` + `db:bootstrap` (chạy một lần mỗi lần triển khai)
#   api     — NestJS (node dist/main.js), chỉ phụ thuộc production
#   web     — Next.js standalone (server.js)
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
# OpenSSL cho schema engine của Prisma (migrate deploy).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.9.1 && pnpm --version
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# prisma.config.ts đòi DATABASE_URL kể cả khi chỉ generate: giá trị giả, không kết nối lúc build.
RUN pnpm build:shared && DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @ql-tro/api build
# Rewrite /api/* của Next.js được chốt lúc build (Caddy vẫn chuyển /api/* thẳng tới api).
ARG API_INTERNAL_URL=http://api:4000
RUN NEXT_OUTPUT=standalone API_INTERNAL_URL=${API_INTERNAL_URL} pnpm --filter @ql-tro/web build
RUN pnpm --filter @ql-tro/api deploy --legacy --prod /out/api && rm -rf /out/api/dist && cp -r apps/api/dist /out/api/dist

FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm db:bootstrap"]

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
# Kho tệp riêng tư (volume `files`): tạo sẵn thuộc user node để volume mới mang đúng quyền ghi.
RUN mkdir -p /data/files && chown node:node /data/files
ENV STORAGE_DIR=/data/files
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
