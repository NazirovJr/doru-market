# syntax=docker/dockerfile:1
#
# apps/worker — multi-stage сборка фонового процесса (BullMQ, без HTTP-трафика клиентов, SRS-NFR-037).
#
# ASSUMPTION (DTJ-002, «Риски»): собственный Dockerfile per-app для волны 1 фундамента, по аналогии
# с apps/api. `docs/spec/31-nfr-security-testing-devops.md` (SRS-NFR-049) описывает ЦЕЛЕВОЙ единый
# `infra/docker/Dockerfile.api` (общий слой зависимостей api+worker+migrate, разные `target`) —
# консолидация в единый multi-stage файл принадлежит отдельному devops-тикету и не блокирует этот.
#
# `node:22.12-slim` (не `alpine`): нативные аддоны (`pg`) исторически проблемны на musl libc — та же
# причина, что и SRS-NFR-049 для apps/api.

FROM node:22.12-slim AS base
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app

# ---- Слой зависимостей: только манифесты, чтобы кэш Docker не рвался от правки исходников ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/testing-kit/package.json packages/testing-kit/package.json
RUN pnpm install --frozen-lockfile --filter=@dorutj/worker...

# ---- Сборка ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/i18n packages/i18n
COPY packages/testing-kit packages/testing-kit
COPY apps/worker apps/worker
RUN pnpm --filter=@dorutj/worker run build
# `pnpm deploy` собирает самодостаточный node_modules (только резолвленные prod-зависимости,
# workspace:* превращён в реальные версии) — так рекомендует сам pnpm для Docker в монорепозитории.
RUN pnpm --filter=@dorutj/worker deploy --prod /app/deploy/worker

# ---- Продовый рантайм — БЕЗ dev-зависимостей, БЕЗ исходников TS ----
FROM node:22.12-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/deploy/worker/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./dist
COPY apps/worker/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
