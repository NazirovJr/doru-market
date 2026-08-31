# Волна 4 — итог и задание для следующей сессии

> Для: **исполнитель (minimax-m3)**. Составил: CTO. Дата: 01.09.2026.
> Волна 4 остановлена архитектором после фазы SQL по решению владельца продукта.
> Фазы use-cases, presentation, фронтенд, QA и ревью **намеренно не запускались** — вернёмся к ним.
>
> **Порядок чтения:** этот файл → `AGENTS.md` → `docs/05-DEVELOPER-HANDBOOK.md` §5, §8, §17.
> При конфликте с другими документами действует иерархия из `AGENTS.md`.

---

## 1. Состояние на момент остановки

| Гейт | Начало волны 4 | Сейчас | Комментарий |
|---|---|---|---|
| `typecheck` | 14/14 ✅ | **12/14 ❌** | Регресс. Одна причина — задача 1 |
| `lint` | 403 | **474** | Вырос от нового кода |
| `arch:check` | 19 | **3** | Крупное улучшение |
| `test:arch` | 1 красный | **34/34 ✅** | Полностью закрыт |
| `apps/api` | 830 тестов, 86 красных | **1085 тестов, 11 красных** | Тестов +255, красных −75 |
| `apps/web` | 37 тестов, 2 красных | **49 тестов, 2 красных** | — |

**Что это значит:** волна дала большой прирост (+267 тестов), закрыла 16 из 19 архитектурных
нарушений и полностью починила `test:arch`. Регресс один — `typecheck`, и он чинится за минуту.

---

## 2. Что сделано в волне 4

**Фаза разблокировки (по прямому поручению CTO):**

- Устранены 19 нарушений Правила Зависимостей: порты слоя `application` больше не тянут
  `DrizzleDb` из инфраструктуры.
- Починен тестовый ENV — `JWT_PRIVATE_KEY`. Security-тесты (подделка Telegram `initData`,
  replay, брутфорс OTP, переиспользование refresh) **впервые реально выполняются**.
- `test:arch` доведён до 34/34.

**Фазы фундамента, домена и SQL — 88 новых и изменённых файлов:**

| Файл | Тикет |
|---|---|
| `modules/catalog/application/search/ports/search-provider.port.ts` | DTJ-180 |
| `modules/catalog/application/search/providers/null-search.provider.ts` | DTJ-180 |
| `db/schema/search-query-log.schema.ts` + миграции | DTJ-181 |
| `modules/catalog/infrastructure/adapters/postgres-search.adapter.ts` | DTJ-185 |
| `modules/catalog/infrastructure/adapters/postgres-search.sql.ts` | DTJ-185 |
| `modules/catalog/infrastructure/cache/search-cache.service.ts` | DTJ-187 |
| `modules/catalog/application/pharmacies-map/ports/pharmacy-map-repository.port.ts` | DTJ-194 |
| `modules/catalog/application/use-cases/get-pharmacy-map-pins.use-case.ts` | DTJ-196 |
| `apps/worker/src/jobs/prune-search-query-log/*` | DTJ-181 |
| `modules/catalog/domain/errors/search-temporarily-degraded.error.ts` | DTJ-185 |

Поиск размещён **внутри `modules/catalog`**, а не отдельным модулем. Решение верное: поиск
работает над каталогом и не образует самостоятельный ограниченный контекст.

---

## 3. Задачи — выполнять строго по порядку

### Задача 1 [XS, делать первой] — объявить `maplibre-gl`

**Одна причина порождает шесть симптомов:** 4 ошибки `typecheck` и 2 нарушения `arch:check`.

```
apps/web/src/features/pharmacy-map/ui/map-view.tsx:3        TS2307 Cannot find module 'maplibre-gl'
apps/web/src/features/pharmacy-map/ui/map-view.tsx:53       TS2307
apps/web/src/features/pharmacy-map/model/use-map-viewport.ts:3      TS2307
apps/web/src/features/pharmacy-map/model/use-map-viewport.spec.ts:3 TS2307
arch:check  no-non-package-json: map-view.tsx → maplibre-gl
arch:check  no-non-package-json: use-map-viewport.ts → maplibre-gl
```

**Что произошло.** Агент `DTJ-198` правильно **не стал** устанавливать зависимость сам —
это было запрещено, чтобы параллельный `pnpm install` не повредил lock-файл. Но он обязан был
вернуть `maplibre-gl` в поле `needsDependency`, а вместо этого просто заимпортировал.
Правило соблюдено наполовину: запрет выполнен, эскалация — нет.

**Что сделать:**

```bash
pnpm --filter @dorutj/web add maplibre-gl
```

**Критерий:** `npx turbo run typecheck --force` → 14/14; `arch:check` → максимум 1 нарушение.

---

### Задача 2 [S, самая важная по последствиям] — восстановить решение D-06

Два красных теста в `apps/api/src/modules/inventory/application/services/composite-inventory-matcher.service.spec.ts`:

```
× невалидный EAN-13 (неверная контрольная цифра) не участвует в точном совпадении
× штрихкод с префиксом 2 не участвует в точном совпадении (D-06, internal prefix)
```

**Почему это серьёзнее, чем выглядит.** Решение **D-06** (`docs/03-ARCHITECT-DECISIONS.md`)
гласит: штрихкод с префиксом `2` — это **внутренний код конкретного продавца**, а не глобальный
GTIN. Если такой штрихкод участвует в точном сопоставлении, товары **разных аптек склеятся
в одну позицию каталога**. Пользователь увидит цену чужой аптеки на чужой товар.

То же с неверной контрольной цифрой: битый штрихкод не имеет права давать точное совпадение.

**Что сделать:** в `CompositeInventoryMatcherService.matchBatch` шаг «точное совпадение
по штрихкоду» обязан пропускать позиции, у которых:
1. контрольная цифра EAN-13 не сходится;
2. префикс равен `2`.

Такие позиции идут дальше по цепочке D-06: `(chain_id, internal_sku)` → trigram-fuzzy →
очередь ручной модерации `catalog_match_queue`.

VO `Barcode` с проверкой контрольной цифры уже существует — **найди его через grep, не создавай
второй** (правило Ж12).

**Критерий:** оба теста зелёные; в коде видно явную проверку префикса `2` со ссылкой на D-06.

---

### Задача 3 [S] — ошибки строк батча должны попадать в `inventory_sync_errors`

Два красных теста в `ingest-inventory-batch-with-matching.use-case.spec.ts`:

```
× unmatched-строка формирует inventory_sync_errors
× невалидная цена одной строки не блокирует остальные строки батча
```

**Смысл требования.** Аптека загружает выгрузку на 900 позиций. Одна строка с битой ценой
не имеет права уронить весь батч — остальные 899 обязаны примениться, а проблемная попасть
в `inventory_sync_errors`, чтобы аптека увидела её в своём кабинете и исправила.

**Критерий:** оба теста зелёные; частично валидный батч применяется частично, а не отклоняется целиком.

---

### Задача 4 [XS] — фоллбэк тенанта на `neutral`

```
apps/api/src/modules/tenancy/presentation/middleware/tenant-resolution.middleware.spec.ts
× 4. Без X-Tenant-Slug и Host → фоллбэк на slug=neutral, isNeutral=true
```

Алгоритм резолва (устав §3.4): `Host` (custom_domain) → `X-Tenant-Slug` → `neutral`.
Третья ступень не срабатывает.

**Критерий:** тест зелёный.

---

### Задача 5 [M] — роль `pharmacist` не проходит end-to-end

```
test/integration/auth/create-staff-account.spec.ts
× B. happy end-to-end: admin создал pharmacist → pharmacist входит через OTP → JWT с role=pharmacist

test/integration/auth/get-me.spec.ts
× 5. role: pharmacist (созданный через /staff-accounts) тоже имеет доступ
```

Оба падения об одном: аккаунт, созданный админом через `/staff-accounts`, не получает рабочую
роль. Разберись, где рвётся цепочка — при создании, при выдаче JWT или при проверке доступа.

**Критерий:** оба теста зелёные.

---

### Задача 6 [S] — выбор кандидата по дозировке

```
resolve-medicine-by-composite.use-case.spec.ts
× Критерий приёмки #4: top-1 + top-2 похожи, оба с правильной дозировкой → matched
```

Когда два кандидата похожи и оба подходят по дозировке, результат должен быть `matched`,
а не уход в неоднозначность.

---

### Задача 7 [M, требует БД] — сид каталога

```
src/db/seed/seed-catalog.run.spec.ts
× вставляет ≥300 позиций medicines (D-13)
× идемпотентен: повторный запуск не увеличивает счётчик
× содержит комбинированные препараты (≥30 medicines с 2+ substances)
```

Данные уже есть: 317 medicines, 87 substances, 18 categories в `apps/api/src/db/seed/data/`.
Проблема в исполнении сида. Требуется поднятый Postgres:

```bash
pnpm docker:up
pnpm db:migrate
pnpm db:seed
```

**Если Postgres поднять не удаётся — это блокер (правило Ж11).** Верни его в отчёте
с точным текстом ошибки, не пропускай задачу молча.

---

### Задача 8 [S] — цикл обновления токена во фронте

```
apps/web/src/shared/api/http-client.spec.ts
× на 401 TOKEN_EXPIRED вызывает refresh ровно один раз и повторяет запрос
× не зацикливается: повторный 401 после refresh не вызывает refresh снова
```

Второй тест важнее: без защиты от повторного вызова клиент уйдёт в бесконечный цикл
обновления токена и положит и себя, и бэкенд.

---

### Задача 9 [XS] — циклическая зависимость

```
arch:check  no-circular: apps/api/src/db/seed/seed-catalog-drizzle-port.ts
```

---

### Задача 10 [L, последней] — 474 ошибки линтера

Автофиксом **не чинятся**. Разбивка:

| Правило | Кол-во | Характер |
|---|---|---|
| `no-magic-numbers` | 62 | вынести в именованные константы |
| `no-restricted-imports` | 54 | заменить `../../` на алиас `@/` |
| `require-await` | 37 | убрать `async` там, где нет `await` |
| `max-params` | 34 | больше 3 параметров → объект-параметр |
| `no-unsafe-assignment` / `no-unsafe-member-access` | 56 | типизировать вместо неявного `any` |
| `no-non-null-assertion` | 25 | убрать `!`, добавить явную проверку |
| `prefer-for-of` | 25 | заменить индексный цикл |

**Порядок:** сначала `no-restricted-imports` и `prefer-for-of` (механические), потом
`require-await` и `max-params`, в последнюю очередь `no-unsafe-*` — там нужна настоящая типизация.

**Правило Ж3 напоминаю:** ослаблять правила в конфиге запрещено. Чинится код, а не порог.

---

## 4. Что дальше по плану волны 4 (не запускалось)

После задач 1–10 продолжаем волну 4 с того места, где она остановлена:

| Тикет | Что | Зависит от |
|---|---|---|
| `DTJ-188` | `SearchMedicinesUseCase` — оркестрация поиска | 182, 183, 184, 185, 187 |
| `DTJ-189` | `SuggestMedicinesUseCase` — автодополнение | 186, 187 |
| `DTJ-197` | Контроллер карты `GET /api/v1/pharmacies/map` | 196 |
| `DTJ-190` | Контроллер поиска `GET /medicines/search`, `/suggest` | 188, 189 |
| `DTJ-192` | Фронт: `SearchBar` + главный экран | 190 |
| `DTJ-193` | Фронт: экран результатов поиска | 190, 192 |
| `DTJ-198` | Фронт: `MapView` на MapLibre | 194 — **частично сделан**, см. задачу 1 |
| `DTJ-199` | Фронт: экран `/map` | 197, 198 |

**`DTJ-191` не делать** — это заготовка Elasticsearch, помеченная как **R2**. Правило Ж6:
работа вне текущей волны не выполняется.

**Напоминание по Ж2 для контроллеров:** зарегистрировать в модуле, модуль — в `AppModule`,
и **дёрнуть маршрут curl-ом**, приложив ответ к отчёту. Комментарий «следующий тикет подключит»
запрещён.

---

## 5. Блокеры уровня продукта — решает CTO, не трогать самостоятельно

Записаны в `docs/STATE-AND-RESUME-POINT.md` §12. Приведены здесь, чтобы ты понимал контекст
и не тратил время на их обход.

1. **Собранный API не запускается.** TypeScript не переписывает path-алиасы при эмите —
   в `dist` осталось 269 импортов вида `@/...`, которые Node резолвить не умеет.
   Требуется `tsc-alias`. **Установку делает CTO** после завершения твоих задач,
   чтобы не ломать lock-файл параллельным `pnpm install`.
2. **Каталог на in-memory репозиториях.** `CatalogModule` регистрирует
   `InMemoryMedicineReadRepository` вместо Drizzle-адаптера — 317 засеянных позиций не читаются.
   То же в `auth`: репозитории пользователей, OTP и сессий in-memory.
   Отдельная задача, будет поставлена тикетом.
3. **Нумерация эпиков.** Канонический источник — `tickets/00-EPICS.md`:
   `EP-05` = «Приём остатков», `EP-06` = «Умный поиск». В части документов поиск ошибочно
   назван EP-05. Ориентируйся на `tickets/00-EPICS.md`.

---

## 6. Чего не делать

- ❌ Не запускать `DTJ-191` и любую работу из R2
- ❌ Не ставить `tsc-alias` — это делает CTO
- ❌ Не ослаблять правила линтера и не добавлять исключения в `arch:check`
- ❌ Не объявлять волну завершённой — вердикт приёмки выносит CTO (`CLAUDE-CTO.md` §3)
- ❌ Не продолжать работу, если гейт не запускается — это блокер (Ж11, §17 хендбука)
- ❌ Не создавать второй `Barcode` VO — он уже есть (Ж12)

---

## 7. Проверка перед сдачей

```bash
npx turbo run typecheck --force     # обязательно --force, иначе увидишь кэш
npx eslint . --max-warnings=0
npx pnpm exec depcruise --config .dependency-cruiser.cjs apps packages
npx vitest run tests/arch/
npx vitest run --root apps/api
npx vitest run --root apps/web
```

Отчёт — по формату `AGENTS.md` (раздел «Формат отчёта о сдаче тикета»), с выводом каждой команды.
Честный отчёт с блокерами принимается лучше, чем «готово» с сюрпризами.
