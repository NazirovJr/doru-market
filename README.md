# DoruTJ

Фармацевтический маркетплейс Республики Таджикистан: поиск лекарств с ценами и остатками аптек, подбор аналогов по действующему
веществу, заказ с оплатой наличными и учётным escrow-ledger, доставка курьером. Он же — White-Label платформа для аптечных сетей
(бренд, домен и палитра живут в конфиге тенанта). Языки интерфейса: таджикский, русский, английский.

**Стек:** монорепо pnpm + Turborepo; `apps/api` — NestJS 11 на Fastify; PostgreSQL + Drizzle; Redis + BullMQ;
фронты — React 19 + Vite; Node >= 22.13.

## Быстрый старт

```bash
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d postgres redis   # зависимости dev-стека
# .env для apps/api, apps/worker, apps/web — по образцам .env.example рядом с ними
pnpm db:migrate && pnpm db:seed                                          # схема и каталог
pnpm dev                                                                 # turbo run dev: api, worker и фронты
pnpm verify                                                              # typecheck + lint + arch:check + test:arch + test + build
```

## Карта репозитория

| Папка | Что там |
|---|---|
| [`apps/`](apps/api/README.md) | приложения: `api`, `worker`, `web` (покупатели), `pharmacy` (кабинет аптеки), `admin` (операторы) |
| [`packages/`](packages/contracts/README.md) | общие библиотеки `@dorutj/*`: contracts, domain-kernel, i18n, testing-kit, ui |
| [`tests/`](tests/README.md) | сквозные наборы: arch, e2e, invariants, security, общие фикстуры |
| [`infra/`](infra/README.md) | Docker, nginx, скрипты деплоя |
| [`scripts/`](scripts/README.md) | автоматизация репозитория: CI-проверки, данные, локальные модели, координатор |
| [`tickets/`](tickets/README.md) | бэклог: тикеты `DTJ-*` по эпикам |
| [`docs/`](docs/README.md) | вся документация: продукт, спека, архитектура, гайды, процессы |

Начинай с [`docs/README.md`](docs/README.md) и [`docs/status/state.md`](docs/status/state.md); правила работы для людей и агентов —
[`AGENTS.md`](AGENTS.md).
