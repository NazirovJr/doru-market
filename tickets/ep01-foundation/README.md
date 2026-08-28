# EP-01 — Фундамент: оглавление тикетов

> Владелец: Tech Lead EP-01. Диапазон ID: **DTJ-001 .. DTJ-030** (в резерве DTJ-031..049, не
> использованы — нет тикетов, которые оправдывали бы дальнейшее дробление; см. `tickets/00-EPICS.md`
> «если тикетов получается больше, чем влезает в диапазон — укрупни, а не выходи за границы» —
> обратная ситуация (диапазон не исчерпан) укрупнению не мешает).
> Источники: `docs/04-SCOPE-DECISION-PIVOT.md` (R1-12 Auth) → `docs/03-ARCHITECT-DECISIONS.md`
> (D-01, D-02, D-05..D-08, D-11 контекстно) → `docs/02-CLEAN-ARCHITECTURE-AND-CODE.md` (слои, C1-C18)
> → `docs/01-TECH-BASELINE.md` (версии) → `docs/spec/00-SRS-MASTER.md`, `10-domain-model.md`,
> `11-database-schema.md`, `12-api-conventions-auth-tenancy.md`, `30-ux-screens-and-flows.md`
> (§5, §«Login»), `32-design-reference.md` (§«Login») → `tickets/00-EPICS.md` (владение файлами,
> волны).

Цель EP-01 (по `tickets/00-EPICS.md`): дать всем последующим модулям доменные инварианты
(shared-kernel Value Objects), схему БД (базовые таблицы + инструментарий миграций), API-каркас
NestJS+Fastify, OTP+JWT-аутентификацию и RBAC-guard'ы — без которых ни один CRUD любого другого эпика
не имеет основания. Ничего не блокирует EP-01 (первый эпик волны 1); от него транзитивно зависят все
остальные 18 эпиков R1.

---

## Порядок выполнения (топологические группы)

Тикеты внутри одной группы независимы друг от друга и могут разрабатываться параллельно; каждая
следующая группа зависит только от предыдущих. Полные `depends_on` — в каждом файле тикета.

### Группа 1 — Точки входа приложений (ничего не блокирует)
Полностью параллельно, разные потоки:
- **DTJ-001** Scaffolding `apps/api` (NestJS+Fastify, health/ready, логирование, безопасность транспорта)
- **DTJ-002** Scaffolding `apps/worker` (NestJS worker, BullMQ, health-порт, каркас outbox-релея)
- **DTJ-003** Scaffolding `apps/web` (Vite+React shell, роутер, API-клиент)
- **DTJ-004** `packages/i18n` — минимальный скелет словарей (tj/ru/en) и `useT()`
- **DTJ-005** `packages/contracts` — скелет: полный каталог `ErrorCode`, permission-строки, cursor-пагинация

### Группа 2 — Доменное ядро (`shared-kernel`), зависит от DTJ-001
- **DTJ-006** `shared-kernel` bootstrap: `Result`, порты `Clock`/`IdGenerator` + адаптеры
- Далее параллельно (все зависят только от DTJ-006):
  - **DTJ-007** VO `Money`
  - **DTJ-008** VO `PhoneNumber`, `TenantId`, `TenantSlug`
  - **DTJ-009** VO `GeoPoint`, `Barcode`, `Dosage`, `DosageForm`
  - **DTJ-010** VO `OtpCode` + `OtpGeneratorPort`/адаптер
  - **DTJ-011** VO `OrderNumber` (+ Redis-порт) и `ExpiryDate`

### Группа 3 — Схема БД и миграции, зависит от DTJ-001
- **DTJ-012** DB-инструментарий: `drizzle-kit`, скрипты, `0001_extensions.sql`
- **DTJ-013** `enums.schema.ts` bootstrap (`user_role`, `otp_purpose`) — зависит от DTJ-012
- Далее параллельно (все зависят от DTJ-013):
  - **DTJ-014** Схема `users`, `user_addresses` (FK на tenants/pharmacies отложены)
  - **DTJ-016** Схема `outbox`, `processed_events` — зависит также от DTJ-002, DTJ-006
- Затем:
  - **DTJ-015** Схема `auth_sessions`, `otp_codes` — зависит от DTJ-013, DTJ-014
  - **DTJ-017** Схема `idempotency_keys` — зависит от DTJ-014

### Группа 4 — API-конвенции presentation-уровня, зависит от Группы 1
- **DTJ-018** Единый конверт ответа, `DomainExceptionFilter`/`TransportExceptionFilter`, cursor-хелперы (зависит от DTJ-001, DTJ-005)
- **DTJ-019** Idempotency-Key перехватчик (зависит от DTJ-017, DTJ-018)
- **DTJ-020** Rate limiting: `@fastify/rate-limit` + Redis (зависит от DTJ-001)
- **DTJ-021** OpenAPI: генерация из Zod, `docs/api/openapi.json` (зависит от DTJ-001, DTJ-005)

### Группа 5 — Модуль `auth`: каркас и guard'ы
- **DTJ-022** Каркас `modules/auth`, JWT RS256, `AuthGuard`, `RolesGuard`/`@Roles` — зависит от
  DTJ-001, DTJ-005, DTJ-006, DTJ-008, DTJ-014, DTJ-015, DTJ-018

### Группа 6 — OTP-логин (последовательная цепочка внутри auth)
- **DTJ-023** `RequestOtpUseCase` + `MockSmsProvider` + `POST /auth/otp/request` — зависит от DTJ-022, DTJ-010, DTJ-020
- **DTJ-024** `VerifyOtpUseCase` + `POST /auth/otp/verify` — зависит от DTJ-023
- Далее параллельно (оба зависят только от DTJ-024):
  - **DTJ-025** Ротация refresh + reuse detection + `POST /auth/refresh`
  - **DTJ-026** Logout/logout-all + список и отзыв устройств
  - **DTJ-030** `CreateStaffAccountUseCase` + `POST /staff-accounts` — зависит от DTJ-022, DTJ-024

### Группа 7 — Telegram TWA, зависит от DTJ-022, DTJ-013
- **DTJ-027** Telegram TWA auth: валидация `initData`, `user_telegram_identities`, `POST /auth/telegram`

### Группа 8 — Клиент и приёмка
- **DTJ-028** `apps/web`: экран `/login` — зависит от DTJ-003, DTJ-004, DTJ-023, DTJ-024
- **DTJ-029** Тест-сьют безопасности Auth (брутфорс/гонки/reuse/изоляция тенантов) — зависит от
  DTJ-023, DTJ-024, DTJ-025, DTJ-026, DTJ-020 — **финальный гейт эпика**, замыкает критический путь

---

## Полная таблица тикетов

| ID | Заголовок | Слой | Оценка |
|---|---|---|---|
| DTJ-001 | Scaffolding `apps/api` — NestJS+Fastify, health/ready, логирование, безопасность | infra | L |
| DTJ-002 | Scaffolding `apps/worker` — BullMQ, health-порт, каркас outbox-релея | infra | M |
| DTJ-003 | Scaffolding `apps/web` — Vite+React shell, роутер, API-клиент | frontend | M |
| DTJ-004 | `packages/i18n` — минимальный скелет словарей и `useT()` | infra | S |
| DTJ-005 | `packages/contracts` — `ErrorCode`, permission-строки, cursor-пагинация | infra | L |
| DTJ-006 | `shared-kernel` bootstrap: `Result`, `Clock`/`IdGenerator` | domain | M |
| DTJ-007 | VO `Money` | domain | S |
| DTJ-008 | VO `PhoneNumber`, `TenantId`, `TenantSlug` | domain | S |
| DTJ-009 | VO `GeoPoint`, `Barcode`, `Dosage`, `DosageForm` | domain | M |
| DTJ-010 | VO `OtpCode` + `OtpGeneratorPort`/адаптер | domain | M |
| DTJ-011 | VO `OrderNumber` (+ Redis-порт), `ExpiryDate` | domain | M |
| DTJ-012 | DB-инструментарий: `drizzle-kit`, скрипты, `0001_extensions.sql` | infrastructure | M |
| DTJ-013 | `enums.schema.ts` bootstrap (`user_role`, `otp_purpose`) | infrastructure | S |
| DTJ-014 | Схема `users`, `user_addresses` | infrastructure | M |
| DTJ-015 | Схема `auth_sessions`, `otp_codes` | infrastructure | M |
| DTJ-016 | Схема `outbox`, `processed_events` + реальный адаптер релея | infrastructure | M |
| DTJ-017 | Схема `idempotency_keys` | infrastructure | S |
| DTJ-018 | Единый конверт ответа, фильтры ошибок, cursor-хелперы | presentation | L |
| DTJ-019 | Idempotency-Key перехватчик | presentation | M |
| DTJ-020 | Rate limiting: `@fastify/rate-limit` + Redis | presentation | M |
| DTJ-021 | OpenAPI: генерация из Zod, `docs/api/openapi.json` | presentation | M |
| DTJ-022 | Каркас `modules/auth`, JWT RS256, `AuthGuard`/`RolesGuard` | presentation | L |
| DTJ-023 | `RequestOtpUseCase` + `MockSmsProvider` + `/auth/otp/request` | application | M |
| DTJ-024 | `VerifyOtpUseCase` + `/auth/otp/verify` | application | L |
| DTJ-025 | Ротация refresh + reuse detection + `/auth/refresh` | application | M |
| DTJ-026 | Logout/logout-all + список и отзыв устройств | application | M |
| DTJ-027 | Telegram TWA auth + `user_telegram_identities` | application | L |
| DTJ-028 | `apps/web`: экран `/login` | frontend | L |
| DTJ-029 | Тест-сьют безопасности Auth | tests | M |
| DTJ-030 | `CreateStaffAccountUseCase` + `/staff-accounts` | application | M |

---

## Известные пробелы SRS, закрытые точечно внутри тикетов (не отдельными тикетами)

Все три — реальные расхождения/пробелы в `docs/spec/*.md`, того же класса, что уже официально
признан архитектором для `SRS-DOM-372/585/909` (`docs/STATE-AND-RESUME-POINT.md` §2.2.2 п.2), а не
допущенные этим планированием домыслы:

1. **`auth_sessions` vs `refresh_tokens`** — `docs/spec/11-database-schema.md` таблица 18 называет
   сущность `refresh_tokens` с укороченным составом колонок; `docs/spec/12-api-conventions-auth-
   tenancy.md` §3.2-3.4 описывает функциональность (ротация, reuse detection, список устройств),
   физически требующую `family_id`/`device_label`/`ip_address`/`last_seen_at` под именем
   `auth_sessions`. Решение (DTJ-015): реализовать по `12-api-conventions`, точечно поправить
   `11-database-schema.md`.
2. **`idempotency_keys`** — упомянута только в прозе `SRS-API-010`, отсутствует в 45-табличном DDL.
   Решение (DTJ-017): реализовать по прямой цитате `SRS-API-010`, дополнить DDL-реестр.
3. **`user_telegram_identities`** — упомянута только в прозе `SRS-API-031` шаг 9, отсутствует в DDL;
   дополнительно потребовала снятия `NOT NULL` с `users.phone_number` (Telegram-путь входа не имеет
   телефона на этапе первого входа). Решение (DTJ-027): минимальная таблица по цитате, `ALTER COLUMN
   ... DROP NOT NULL`, дополнить DDL-реестр.

Если на общей приёмке SRS архитектор заведёт централизованный тикет «сверка и перенумерация» (по
аналогии с уже запланированным для `SRS-DOM-372/585/909`, `docs/STATE-AND-RESUME-POINT.md` §4.2) —
эти три точечные правки можно консолидировать туда постфактум; сейчас решено не ждать и закрыть
локально, чтобы не блокировать реализацию R1-12.

## Осознанно отложенные внешние ключи

`users.tenant_id`/`pharmacy_id`/`chain_id` и `outbox.tenant_id` (DTJ-014, DTJ-016) заведены как
`uuid`-колонки БЕЗ `.references(...)` — таблицы `tenants` (EP-02) и `pharmacies`/`pharmacy_chains`
(EP-03) ещё не существуют на момент этого эпика (EP-01 — первый по графу зависимостей, ничего не
блокирует). Реальные `ALTER TABLE ... ADD CONSTRAINT FOREIGN KEY` — ответственность тикетов EP-02/
EP-03, создающих целевые таблицы (тот же паттерн, что уже принят архитектором для
`0015_deferred_fks.sql` в `docs/spec/11-database-schema.md` §«Порядок миграций» — не изобретение
этого планирования). Зафиксировано явно в DTJ-014/DTJ-016 «Риски» для координации со следующими
тимлидами.

## Временные решения, требующие замены следующими эпиками

- **Резолвинг тенанта** (DTJ-023/024/029) — до готовности EP-02 (`TenantResolutionMiddleware`)
  контроллеры auth читают `tenantId` временным механизмом (ENV-дефолт на нейтральный тенант/заголовок
  `X-Tenant-Slug` без полноценной валидации). Сигнатуры use case уже принимают `tenantId` явным
  параметром — замена презентационного источника не потребует переписывать application-слой.
- **`TELEGRAM_BOT_TOKEN_NEUTRAL`** (DTJ-027) — упрощение относительно полного `SRS-API-032`
  (per-tenant токен из `tenant_settings.telegram_bot_token_ref`); достаточно для нейтрального
  тенанта R1, требует замены при переходе к White-Label (R3).
- **`packages/ui`** (DTJ-003, DTJ-028) — не в зоне EP-01 (владелец — EP-18). Экран `/login` временно
  верстается на голых Tailwind-классах с явными `// TODO(EP-18)`, если минимальный бутстрап
  `packages/ui` (параллельный поток «Волны 1», `tickets/00-EPICS.md`) отстаёт по времени.
