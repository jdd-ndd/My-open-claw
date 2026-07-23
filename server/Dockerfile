# MyOpenClaw 服务端 Docker 镜像
FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile --filter @myopenclaw/server

COPY server/ ./server/
RUN pnpm --filter @myopenclaw/server build

# 生产运行镜像
FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/package.json ./
COPY --from=builder /app/server/config ./config
COPY --from=builder /app/server/skills ./skills

ENV NODE_ENV=production
EXPOSE 18780 18790

CMD ["node", "dist/index.js"]
