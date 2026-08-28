# apps/api/Dockerfile — DTJ-001, шаг 7.
# Multi-stage: deps -> build -> deploy -> runtime. Контекст сборки — КОРЕНЬ монорепозитория
# (см. DoD тикета: `docker build -f apps/api/Dockerfile .`), т.к. `apps/api` — часть pnpm
# workspace и не собирается в отрыве от корневого lockfile.
#
# `node:22.12-slim`, НЕ `alpine`: `argon2` (01-TECH-BASELINE.md §Backend) — нативный
# аддон; на glibc (slim) для него куда чаще есть готовый prebuild, чем на musl (alpine),
# а `deps`-стадия всё равно держит компилятор про запас на случай, если prebuild не найдётся.
#
# ВНИМАНИЕ при добавлении нового пакета в pnpm-workspace (`apps/*`, `packages/*`, `tests/*`):
# `pnpm install --frozen-lockfile` требует package.json КАЖДОГО workspace-участника на диске
# — новый пакет нужно добавить отдельной строкой `COPY .../package.json` в стадии `deps` ниже,
# иначе сборка образа сломается с ошибкой рассинхронизации lockfile.

ARG NODE_IMAGE=node:22.12-slim

FROM ${NODE_IMAGE} AS base
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate
WORKDIR /repo

# ---------- deps: pnpm install --frozen-lockfile по всему workspace ----------
FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/testing-kit/package.json packages/testing-kit/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY tests/e2e/package.json tests/e2e/package.json
RUN pnpm install --frozen-lockfile

# ---------- build: apps/api + его workspace-зависимости (@dorutj/contracts) ----------
FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @dorutj/api... run build

# ---------- deploy: prod-only срез apps/api (`pnpm deploy`, без devDependencies) ----------
FROM build AS deploy
RUN pnpm --filter @dorutj/api deploy --prod /out

# ---------- runtime: минимальный слой, без тулчейна сборки и без pnpm ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 dorutj \
  && useradd --system --uid 1001 --gid dorutj --home-dir /app --shell /usr/sbin/nologin dorutj
WORKDIR /app
COPY --from=deploy --chown=dorutj:dorutj /out/dist ./dist
COPY --from=deploy --chown=dorutj:dorutj /out/node_modules ./node_modules
COPY --from=deploy --chown=dorutj:dorutj /out/package.json ./package.json
COPY --chown=dorutj:dorutj apps/api/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
USER dorutj
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
