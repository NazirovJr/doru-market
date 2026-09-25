# DTJ Tickets — Индекс и план запуска разработки

> Владелец: Tech Lead. Источник данных: все файлы `tickets/ep*/DTJ-*.md` (271 тикет) +
> `tickets/00-EPICS.md` (19 эпиков R1). Иерархия приоритета документов — см.
> `04-SCOPE-DECISION-PIVOT.md` → `03-ARCHITECT-DECISIONS.md` → `02-CLEAN-ARCHITECTURE-AND-CODE.md` →
> `01-TECH-BASELINE.md` → `00-PROJECT-CHARTER.md` → `docs/spec/*.md` → `tz.log`.
>
> Методологическое замечание, важное для чтения всего документа: поле `depends_on` в каждом
> тикете кодирует зависимости **только внутри своего эпика** (проверено эмпирически — из 271
> тикета только 19 depends_on-рёбер ведут в другой эпик, и почти все они — предметные, не
> организационные, см. раздел «Проблемы»). Первый тикет каждого эпика физически имеет
> `depends_on: []`, даже если сам эпик по `00-EPICS.md` заблокирован несколькими предыдущими
> эпиками — это **не** дефект тикета, а сознательная конвенция авторов (эпик-уровневая
> блокировка живёт только в `00-EPICS.md`, не дублируется в каждом первом тикете). Поэтому
> «волна», посчитанная наивно по одному только графу `depends_on` тикетов, была бы неверной:
> она показала бы, что тикеты позднего эпика (например, `EP-13`) можно начинать одновременно с
> `EP-01`. Все расчёты волн/критического пути в этом документе используют **комбинированную**
> модель: эпик-уровневые волны из `00-EPICS.md` (кто-какой-эпик открывает) + внутриэпиковый граф
> `depends_on` (в каком порядке выполнять тикеты внутри уже открытого эпика).

---

## Сводка

**Всего тикетов: 271** (диапазоны DTJ-001..DTJ-030, DTJ-050..DTJ-076, DTJ-090..DTJ-104, DTJ-140..DTJ-170, DTJ-180..DTJ-199, DTJ-220..DTJ-255, DTJ-270..DTJ-284, DTJ-300..DTJ-332, DTJ-350..DTJ-384, DTJ-400..DTJ-428; промежутки между диапазонами — зарезервированные, но неиспользованные ID, см. `ep01-foundation/README.md` шапку — это осознанный запас на будущие тикеты внутри эпика, не дыра в нумерации).

### По эпикам
| Эпик | Тикетов |
|---|---|
| EP-01 — Фундамент | 30 |
| EP-02 — Мультитенантность (tenant-guard) | 13 |
| EP-03 — Онбординг сети/аптеки | 14 |
| EP-04 — Модель каталога | 9 |
| EP-05 — Приём остатков (3 канала) | 31 |
| EP-06 — Умный поиск + ранжирование + автодополнение | 14 |
| EP-07 — Analog Engine | 6 |
| EP-08 — Карта аптек | 6 |
| EP-09 — Корзина + Checkout | 16 |
| EP-10 — Оплата наличными + Escrow-ledger | 20 |
| EP-11 — Возвраты (деньги + склад) | 8 |
| EP-12 — Терминал фармацевта (API + веб-кабинет сборки) | 13 |
| EP-13 — Курьерский веб-модуль | 20 |
| EP-14 — Споры (облегчённые) + поддержка | 7 |
| EP-15 — Админ-панель super_admin и кабинет pharmacy_admin | 18 |
| EP-16 — NotificationService (Telegram) + audit_log | 10 |
| EP-17 — Продуктовая аналитика воронки R1-15 | 7 |
| EP-18 — Слой UX | 12 |
| EP-19 — CI/DevOps/тестовая пирамида | 17 |

### По архитектурному слою (`layer`)
| Слой | Тикетов |
|---|---|
| application | 102 |
| infrastructure | 52 |
| frontend | 43 |
| presentation | 25 |
| domain | 22 |
| tests | 17 |
| infra | 10 |

`infra` (10) — корневой bootstrap приложений/пакетов (не относится к
domain/application/infrastructure/presentation конкретного модуля); `tests` (17) —
выделенные тест-тикеты (E2E, security, load, arch, contract-тесты изоляции), помимо
этого тесты пишутся внутри каждого обычного тикета согласно его Definition of Done.

### По оценке (`estimate`)
| Оценка | Тикетов | Условных единиц (см. допущение ниже) |
|---|---|---|
| XS | 4 | 4 |
| S | 77 | 154 |
| M | 142 | 426 |
| L | 48 | 240 |
| **Итого** | **271** | **824** |

**Допущение:** ни один документ иерархии (`00-EPICS.md`, `03-ARCHITECT-DECISIONS.md`,
`02-CLEAN-ARCHITECTURE-AND-CODE.md`) не определяет числовой эквивалент T-shirt-оценок
тикетов (`XS/S/M/L`; на уровне эпиков дополнительно встречается `XL`, но ни один
отдельный тикет не имеет `estimate: XL` — эпики раздроблены до L и мельче). Для
арифметики «Критического пути» и суммарной оценки в этом документе введена собственная
шкала условных единиц: `XS=1, S=2, M=3, L=5` (Фибоначчи-подобная, распространённая
практика relative estimation) — это осознанное **допущение автора индекса**, не факт
из исходных документов; при наличии другой шкалы у Tech Lead все числа в разделах
«Критический путь» пересчитываются механически.

---

## Полный реестр

Отсортировано по числовому ID. Колонка «Файлы (owned)» сокращена до первых трёх путей
(полный список — в самом файле тикета, поле `files_owned`); `**` в пути означает
владение директорией целиком.

| ID | Заголовок | Эпик | Слой | Оценка | Зависит от | Файлы (owned) |
|---|---|---|---|---|---|---|
| DTJ-001 | Scaffolding apps/api — NestJS+Fastify каркас, health/ready, логирование, безопасность транспорта | EP-01 | infra | L | — | apps/api/package.json; apps/api/tsconfig.json; apps/api/src/main.ts; +8 файлов |
| DTJ-002 | Scaffolding apps/worker — NestJS worker-процесс, BullMQ, health-порт, каркас OutboxRelayWorker | EP-01 | infra | M | — | apps/worker/package.json; apps/worker/tsconfig.json; apps/worker/src/main.ts; +8 файлов |
| DTJ-003 | Scaffolding apps/web — Vite+React shell, роутер, API-клиент, точки подключения i18n/ui | EP-01 | frontend | M | — | apps/web/package.json; apps/web/tsconfig.json; apps/web/vite.config.ts; +5 файлов |
| DTJ-004 | packages/i18n — минимальный скелет словарей tj/ru/en и хук useT() | EP-01 | infra | S | — | packages/i18n/package.json; packages/i18n/tsconfig.json; packages/i18n/src/index.ts; +4 файлов |
| DTJ-005 | packages/contracts — скелет: полный каталог ErrorCode, permission-строки RBAC, cursor-пагинация | EP-01 | infra | L | — | packages/contracts/package.json; packages/contracts/tsconfig.json; packages/contracts/src/index.ts; +5 файлов |
| DTJ-006 | shared-kernel: базовый Result-тип, порты Clock/IdGenerator и их адаптеры | EP-01 | domain | M | DTJ-001 | apps/api/src/shared-kernel/domain/result.ts; apps/api/src/shared-kernel/application/ports/clock.port.ts; apps/api/src/shared-kernel/application/ports/id-generator.port.ts; +4 файлов |
| DTJ-007 | shared-kernel: Value Object Money (целые дирамы, арифметика, allocate) | EP-01 | domain | S | DTJ-006 | apps/api/src/shared-kernel/domain/value-objects/money.vo.ts; apps/api/src/shared-kernel/domain/errors/currency-mismatch.error.ts; apps/api/src/shared-kernel/domain/errors/invalid-money.error.ts |
| DTJ-008 | shared-kernel: Value Objects PhoneNumber, TenantId, TenantSlug | EP-01 | domain | S | DTJ-006 | apps/api/src/shared-kernel/domain/value-objects/phone-number.vo.ts; apps/api/src/shared-kernel/domain/value-objects/tenant-id.vo.ts; apps/api/src/shared-kernel/domain/value-objects/tenant-slug.vo.ts; +2 файлов |
| DTJ-009 | shared-kernel: Value Objects GeoPoint, Barcode, Dosage, DosageForm | EP-01 | domain | M | DTJ-006 | apps/api/src/shared-kernel/domain/value-objects/geo-point.vo.ts; apps/api/src/shared-kernel/domain/value-objects/barcode.vo.ts; apps/api/src/shared-kernel/domain/value-objects/dosage.vo.ts; +2 файлов |
| DTJ-010 | shared-kernel: Value Object OtpCode + OtpGeneratorPort + CryptoOtpGenerator адаптер | EP-01 | domain | M | DTJ-006 | apps/api/src/shared-kernel/domain/value-objects/otp-code.vo.ts; apps/api/src/shared-kernel/application/ports/otp-generator.port.ts; apps/api/src/shared-kernel/infrastructure/adapters/crypto-otp-generator.adapter.ts; +3 файлов |
| DTJ-011 | shared-kernel: Value Objects OrderNumber (+ Redis-порт генерации) и ExpiryDate | EP-01 | domain | M | DTJ-006 | apps/api/src/shared-kernel/domain/value-objects/order-number.vo.ts; apps/api/src/shared-kernel/domain/value-objects/expiry-date.vo.ts; apps/api/src/shared-kernel/application/ports/order-number-generator.port.ts; +2 файлов |
| DTJ-012 | DB-инструментарий: конфигурация drizzle-kit, скрипты миграций, 0001_extensions.sql | EP-01 | infrastructure | M | DTJ-001 | apps/api/drizzle.config.ts; apps/api/src/infrastructure/db/index.ts; apps/api/src/infrastructure/db/migrate.ts; +4 файлов |
| DTJ-013 | enums.schema.ts — bootstrap user_role и otp_purpose + миграция | EP-01 | infrastructure | S | DTJ-012 | apps/api/src/infrastructure/db/schema/enums.schema.ts; apps/api/migrations/0002_enums.sql |
| DTJ-014 | Схема БД: users, user_addresses + миграция (FK на tenants/pharmacies отложены) | EP-01 | infrastructure | M | DTJ-013 | apps/api/src/infrastructure/db/schema/users.schema.ts; apps/api/src/infrastructure/db/schema/user-addresses.schema.ts; apps/api/migrations/0003_users_base.sql |
| DTJ-015 | Схема БД: auth_sessions (ротация refresh) и otp_codes + миграция | EP-01 | infrastructure | M | DTJ-013, DTJ-014 | apps/api/src/infrastructure/db/schema/auth-sessions.schema.ts; apps/api/src/infrastructure/db/schema/otp-codes.schema.ts; apps/api/migrations/0004_auth_sessions_otp.sql |
| DTJ-016 | Схема БД: outbox, processed_events + подключение реального адаптера к OutboxRelayWorker | EP-01 | infrastructure | M | DTJ-013, DTJ-002, DTJ-006 | apps/api/src/infrastructure/db/schema/outbox.schema.ts; apps/api/src/infrastructure/db/schema/processed-events.schema.ts; apps/api/migrations/0005_outbox.sql; +1 файлов |
| DTJ-017 | Схема БД: idempotency_keys + миграция (заполняет пробел в 11-database-schema.md) | EP-01 | infrastructure | S | DTJ-014 | apps/api/src/infrastructure/db/schema/idempotency-keys.schema.ts; apps/api/migrations/0006_idempotency_keys.sql |
| DTJ-018 | API-конвенции: единый конверт ответа, DomainExceptionFilter/TransportExceptionFilter, cursor-хелперы | EP-01 | presentation | L | DTJ-001, DTJ-005 | apps/api/src/common/http/filters/domain-exception.filter.ts; apps/api/src/common/http/filters/transport-exception.filter.ts; apps/api/src/common/http/pipes/cursor-query.pipe.ts; +2 файлов |
| DTJ-019 | Idempotency-Key: перехватчик, сравнение по sha256(body), обработка гонки, TTL-очистка | EP-01 | presentation | M | DTJ-017, DTJ-018 | apps/api/src/common/http/interceptors/idempotency.interceptor.ts; apps/api/src/common/http/decorators/idempotent.decorator.ts; apps/api/src/infrastructure/repositories/idempotency-keys.repository.ts; +1 файлов |
| DTJ-020 | Rate limiting: @fastify/rate-limit + Redis store, глобальные лимиты и декоратор @RateLimit | EP-01 | presentation | M | DTJ-001 | apps/api/src/common/http/rate-limit/rate-limit.module.ts; apps/api/src/common/http/rate-limit/rate-limit.decorator.ts; apps/api/src/common/http/rate-limit/rate-limit.guard.ts |
| DTJ-021 | OpenAPI: генерация из Zod (zod-to-openapi), Swagger UI за ENV-флагом, docs/api/openapi.json | EP-01 | presentation | M | DTJ-001, DTJ-005 | apps/api/src/common/openapi/openapi.module.ts; apps/api/src/common/openapi/openapi.builder.ts; apps/api/package.json |
| DTJ-022 | modules/auth: каркас модуля, JWT RS256 (подпись/верификация), AuthGuard, RolesGuard/@Roles | EP-01 | presentation | L | DTJ-001, DTJ-005, DTJ-006, DTJ-008, DTJ-014, DTJ-015, DTJ-018 | apps/api/src/modules/auth/auth.module.ts; apps/api/src/modules/auth/index.ts; apps/api/src/modules/auth/application/ports/jwt-signer.port.ts; +8 файлов |
| DTJ-023 | RequestOtpUseCase + MockSmsProvider + POST /api/v1/auth/otp/request | EP-01 | application | M | DTJ-022, DTJ-010, DTJ-020 | apps/api/src/modules/auth/application/use-cases/request-otp.use-case.ts; apps/api/src/modules/auth/application/ports/sms-provider.port.ts; apps/api/src/modules/auth/infrastructure/adapters/mock-sms-provider.adapter.ts; +3 файлов |
| DTJ-024 | VerifyOtpUseCase + POST /api/v1/auth/otp/verify (find-or-create, выдача JWT/refresh) | EP-01 | application | L | DTJ-023 | apps/api/src/modules/auth/application/use-cases/verify-otp.use-case.ts; apps/api/src/modules/auth/infrastructure/repositories/auth-sessions.repository.ts; apps/api/src/modules/auth/presentation/controllers/otp-verify.controller.ts; +1 файлов |
| DTJ-025 | RefreshUseCase: ротация refresh-токена + обнаружение переиспользования + POST /auth/refresh | EP-01 | application | M | DTJ-024 | apps/api/src/modules/auth/application/use-cases/refresh-token.use-case.ts; apps/api/src/modules/auth/presentation/controllers/refresh.controller.ts; apps/api/src/modules/auth/presentation/dto/refresh.dto.ts |
| DTJ-026 | Logout, logout-all, список и отзыв устройств (GET/DELETE /auth/sessions) | EP-01 | application | M | DTJ-024 | apps/api/src/modules/auth/application/use-cases/logout.use-case.ts; apps/api/src/modules/auth/application/use-cases/logout-all.use-case.ts; apps/api/src/modules/auth/application/use-cases/list-sessions.use-case.ts; +2 файлов |
| DTJ-027 | Telegram TWA auth: валидация initData, user_telegram_identities, POST /auth/telegram | EP-01 | application | L | DTJ-022, DTJ-013 | apps/api/src/infrastructure/db/schema/user-telegram-identities.schema.ts; apps/api/migrations/0007_user_telegram_identities.sql; apps/api/src/modules/auth/application/use-cases/telegram-auth.use-case.ts; +5 файлов |
| DTJ-028 | apps/web: экран /login (телефон → OTP), интеграция с authStore и http-client | EP-01 | frontend | L | DTJ-003, DTJ-004, DTJ-023, DTJ-024 | apps/web/src/pages/login/login-page.tsx; apps/web/src/features/auth/api/use-request-otp.ts; apps/web/src/features/auth/api/use-verify-otp.ts; +4 файлов |
| DTJ-029 | Тест-сьют безопасности Auth: брутфорс, гонки, reuse detection, изоляция телефонов по тенанту | EP-01 | tests | M | DTJ-023, DTJ-024, DTJ-025, DTJ-026, DTJ-020 | apps/api/test/integration/auth/otp-brute-force.spec.ts; apps/api/test/integration/auth/refresh-reuse-detection.spec.ts; apps/api/test/integration/auth/otp-verify-race.spec.ts; +1 файлов |
| DTJ-030 | CreateStaffAccountUseCase + POST /api/v1/staff-accounts (заведение pharmacist/courier/support_agent) | EP-01 | application | M | DTJ-022, DTJ-024 | apps/api/src/modules/auth/application/use-cases/create-staff-account.use-case.ts; apps/api/src/modules/auth/application/policies/staff-account.policy.ts; apps/api/src/modules/auth/presentation/controllers/staff-accounts.controller.ts; +1 файлов |
| DTJ-031 | Outbox-relay: реальный PgOutboxReaderAdapter вместо Noop-заглушки (долг DTJ-016) | EP-01 | infrastructure | M | DTJ-016 | apps/worker/src/jobs/outbox-relay/pg-outbox-reader.adapter.ts; apps/worker/src/jobs/outbox-relay/outbox-relay.processor.ts; packages/contracts/src/domain-event-envelope.ts; +5 файлов |
| DTJ-032 | Роутер доменных событий на очереди domain-events: один Worker, fan-out по eventType | EP-01 | infrastructure | M | DTJ-031, DTJ-274, DTJ-370 | apps/api/src/common/events/domain-events.router.ts; apps/api/src/common/events/domain-event-handler.ts; apps/api/src/common/events/domain-events.module.ts; +4 файлов |
| DTJ-033 | GET /api/v1/tenant/meta — SLA-настройки тенанта для клиентов | EP-01 | presentation | S | DTJ-169 | apps/api/src/modules/tenancy/presentation/tenant-meta.controller.ts; packages/contracts/src/tenant-meta.ts; apps/pharmacy/src/shared/api/use-tenant-meta.ts; +2 файлов |
| DTJ-050 | Создать домен Tenant/TenantSettings, VO и скелет модуля tenancy | EP-02 | domain | M | — | apps/api/src/modules/tenancy/domain/tenant.entity.ts; apps/api/src/modules/tenancy/domain/tenant-settings.entity.ts; apps/api/src/modules/tenancy/domain/value-objects/tenant-id.vo.ts; +7 файлов |
| DTJ-051 | Создать схему БД tenants/tenant_settings и миграцию с seed нейтрального тенанта | EP-02 | infrastructure | S | DTJ-050 | apps/api/src/db/schema/tenants.ts; apps/api/migrations/<next>_tenants_and_settings.sql; apps/api/migrations/<next>_pharmacy_chains_tenant_fk.sql; +1 файлов |
| DTJ-052 | Реализовать TenantRepository и TenantSettingsRepository (Drizzle) | EP-02 | infrastructure | S | DTJ-050, DTJ-051 | apps/api/src/modules/tenancy/infrastructure/repositories/tenant.repository.ts; apps/api/src/modules/tenancy/infrastructure/repositories/tenant-settings.repository.ts; apps/api/src/modules/tenancy/infrastructure/mappers/tenant.mapper.ts; +2 файлов |
| DTJ-053 | Реализовать TenantCacheAdapter (Redis, TTL 60с) с деградацией к БД | EP-02 | infrastructure | S | DTJ-052 | apps/api/src/modules/tenancy/application/ports/tenant-cache.port.ts; apps/api/src/modules/tenancy/infrastructure/adapters/tenant-cache.adapter.ts; apps/api/src/modules/tenancy/application/events/tenant-branding-updated.event.ts; +1 файлов |
| DTJ-054 | Реализовать TenantResolutionMiddleware и TenantContext (AsyncLocalStorage) | EP-02 | presentation | M | DTJ-053 | apps/api/src/common/context/tenant-context.ts; apps/api/src/modules/tenancy/presentation/middleware/tenant-resolution.middleware.ts; apps/api/src/common/decorators/public.decorator.ts |
| DTJ-055 | Реализовать TenantResolutionGuard (400/403/404, super_admin override + аудит) | EP-02 | presentation | M | DTJ-054 | apps/api/src/common/guards/tenant-scope.guard.ts |
| DTJ-056 | Создать TenantScopedRepository и переиспользуемый contract-test на утечку тенанта | EP-02 | tests | M | DTJ-050 | apps/api/src/modules/tenancy/infrastructure/base/tenant-scoped-repository.ts; apps/api/src/modules/tenancy/testing/tenant-isolation.contract-test.ts; apps/api/src/modules/tenancy/testing/fixtures/violator-repository.fixture.ts |
| DTJ-057 | Реализовать ProvisionTenantUseCase и POST /api/v1/admin/tenants | EP-02 | application | M | DTJ-050, DTJ-052, DTJ-055 | apps/api/src/modules/tenancy/application/use-cases/provision-tenant.use-case.ts; apps/api/src/modules/tenancy/application/ports/chain-eligibility.port.ts; apps/api/src/modules/tenancy/infrastructure/adapters/onboarding-chain-eligibility.adapter.ts; +2 файлов |
| DTJ-058 | Реализовать SecretsVaultPort + EnvSecretsVaultAdapter (мерчант-креды и Telegram-токен) | EP-02 | infrastructure | S | DTJ-050 | apps/api/src/modules/tenancy/application/ports/secrets-vault.port.ts; apps/api/src/modules/tenancy/infrastructure/adapters/env-secrets-vault.adapter.ts |
| DTJ-059 | Реализовать движок брендинга — BrandPaletteSchema, PUT/GET /tenant(s)/branding | EP-02 | application | L | DTJ-052, DTJ-053, DTJ-055 | packages/contracts/src/tenancy.ts; apps/api/src/modules/tenancy/application/use-cases/update-branding.use-case.ts; apps/api/src/modules/tenancy/application/use-cases/get-branding.use-case.ts; +1 файлов |
| DTJ-060 | Применить брендинг на фронте без пересборки (bootstrap-branding.ts) + правило запрета хардкода | EP-02 | frontend | S | DTJ-059 | apps/web/src/app/bootstrap-branding.ts; apps/web/index.html |
| DTJ-061 | Реализовать AttachCustomDomainUseCase и фоновую DNS-верификацию | EP-02 | application | M | DTJ-052, DTJ-055 | apps/api/src/modules/tenancy/application/use-cases/attach-custom-domain.use-case.ts; apps/api/src/modules/tenancy/application/ports/dns-verification.port.ts; apps/api/src/modules/tenancy/infrastructure/adapters/dns-txt-verification.adapter.ts; +2 файлов |
| DTJ-062 | Реализовать TelegramWebhookRouter — резолвинг тенанта по пути и проверка secret_token | EP-02 | infrastructure | S | DTJ-058 | apps/api/src/modules/tenancy/presentation/controllers/telegram-webhook.controller.ts; apps/api/src/modules/tenancy/application/ports/telegram-token-resolver.port.ts; apps/api/src/modules/tenancy/infrastructure/adapters/telegram-token-resolver.adapter.ts |
| DTJ-063 | Создать домен PharmacyChain/PharmacyAccount, схему pharmacy_verification/onboarding_review_log | EP-03 | domain | L | — | apps/api/src/modules/onboarding/domain/pharmacy-chain.entity.ts; apps/api/src/modules/onboarding/domain/pharmacy-account.entity.ts; apps/api/src/modules/onboarding/domain/value-objects/onboarding-status.vo.ts; +11 файлов |
| DTJ-064 | Реализовать SubmitChainApplicationUseCase, POST /pharmacy-chains и OTP-верификацию контакта | EP-03 | application | M | DTJ-063 | apps/api/src/modules/onboarding/application/use-cases/submit-chain-application.use-case.ts; apps/api/src/modules/onboarding/application/use-cases/verify-chain-contact-phone.use-case.ts; apps/api/src/modules/onboarding/infrastructure/repositories/pharmacy-chain.repository.ts; +2 файлов |
| DTJ-065 | Реализовать SubmitPharmacyApplicationUseCase, POST /pharmacy-accounts и загрузку документов | EP-03 | application | M | DTJ-063, DTJ-064 | apps/api/src/modules/onboarding/application/use-cases/submit-pharmacy-application.use-case.ts; apps/api/src/modules/onboarding/application/ports/object-storage.port.ts; apps/api/src/modules/onboarding/infrastructure/repositories/pharmacy-account.repository.ts; +2 файлов |
| DTJ-066 | Реализовать переход draft→pending_review (submit) для заявок сети и аптеки | EP-03 | application | S | DTJ-064, DTJ-065 | apps/api/src/modules/onboarding/application/use-cases/submit-chain-for-review.use-case.ts; apps/api/src/modules/onboarding/application/use-cases/submit-pharmacy-for-review.use-case.ts; apps/api/src/modules/onboarding/infrastructure/repositories/pharmacy-verification.repository.ts |
| DTJ-067 | Реализовать очередь верификации — GET pending_review для сетей и аптек | EP-03 | application | S | DTJ-063 | apps/api/src/modules/onboarding/application/use-cases/list-pending-verifications.use-case.ts; apps/api/src/modules/onboarding/presentation/controllers/pharmacy-verification-queue.controller.ts |
| DTJ-068 | Реализовать решения оператора — approve/request-changes/reject/terminate | EP-03 | application | L | DTJ-066, DTJ-067 | apps/api/src/modules/onboarding/application/use-cases/review-chain-application.use-case.ts; apps/api/src/modules/onboarding/application/use-cases/review-pharmacy-application.use-case.ts; apps/api/src/modules/onboarding/infrastructure/repositories/onboarding-review-log.repository.ts; +3 файлов |
| DTJ-069 | Реализовать повторную проверку при смене адреса активной аптеки | EP-03 | application | S | DTJ-068 | apps/api/src/modules/onboarding/application/use-cases/update-pharmacy-address.use-case.ts |
| DTJ-070 | Реализовать OnboardingFacade — публичные запросы статуса для других модулей | EP-03 | application | M | DTJ-068 | apps/api/src/modules/onboarding/index.ts; apps/api/src/modules/onboarding/onboarding.facade.ts; apps/api/src/modules/onboarding/application/ports/pharmacy-chain-status.port.ts; +1 файлов |
| DTJ-071 | Реализовать SuspendPharmacyUseCase и принудительную отмену незавершённых заказов | EP-03 | application | M | DTJ-068, DTJ-070 | apps/api/src/modules/onboarding/application/use-cases/suspend-pharmacy.use-case.ts; apps/api/src/modules/onboarding/application/use-cases/force-cancel-incomplete-orders.use-case.ts; apps/api/src/modules/onboarding/application/ports/orders-cancellation.port.ts; +2 файлов |
| DTJ-072 | Реализовать RevokeVerificationUseCase (отзыв верификации, каскадная приостановка) | EP-03 | application | S | DTJ-071 | apps/api/src/modules/onboarding/application/use-cases/revoke-verification.use-case.ts; apps/api/src/modules/onboarding/presentation/controllers/pharmacy-verification-revocation.controller.ts |
| DTJ-073 | Реализовать LicenseExpiryCheckJob и список истекающих лицензий | EP-03 | infrastructure | M | DTJ-071 | apps/worker/src/jobs/license-expiry-check/license-expiry-check.job.ts; apps/api/src/modules/onboarding/application/use-cases/list-expiring-licenses.use-case.ts; apps/api/src/modules/onboarding/presentation/controllers/pharmacy-accounts-admin.controller.ts |
| DTJ-074 | Реализовать RequestReactivationUseCase (suspended → pending_review) | EP-03 | application | S | DTJ-071 | apps/api/src/modules/onboarding/application/use-cases/request-reactivation.use-case.ts |
| DTJ-075 | Scaffolding apps/admin — очередь верификации и карточка заявки (первый экран admin) | EP-03 | frontend | L | DTJ-067, DTJ-068 | apps/admin/** |
| DTJ-076 | Реализовать публичную форму заявки аптеки/сети /pharmacy-application (apps/web) | EP-03 | frontend | M | DTJ-064, DTJ-065 | apps/web/src/features/onboarding-application/** |
| DTJ-090 | Скаффолдинг модуля catalog + пакет packages/domain-kernel (Dosage/DosageForm/Barcode VO) | EP-04 | infrastructure | S | — | apps/api/src/modules/catalog/catalog.module.ts; apps/api/src/modules/catalog/index.ts; apps/api/src/modules/catalog/domain/README.md; +10 файлов |
| DTJ-091 | DDL и Drizzle-схема для categories/substances/medicines/medicine_substances | EP-04 | infrastructure | M | DTJ-090 | apps/api/src/db/schema/categories.ts; apps/api/src/db/schema/substances.ts; apps/api/src/db/schema/medicines.ts; +2 файлов |
| DTJ-092 | CatalogRepository — порт и Drizzle-адаптер для medicines/substances/categories | EP-04 | infrastructure | M | DTJ-090, DTJ-091 | apps/api/src/modules/catalog/application/ports/catalog-repository.port.ts; apps/api/src/modules/catalog/infrastructure/adapters/catalog-repository.adapter.ts; apps/api/src/modules/catalog/infrastructure/mappers/medicine.mapper.ts; +1 файлов |
| DTJ-093 | Domain-сущность Medicine + MedicineSubstance, инварианты и модерационный gate control_category | EP-04 | domain | M | DTJ-090, DTJ-092 | apps/api/src/modules/catalog/domain/medicine.entity.ts; apps/api/src/modules/catalog/domain/medicine-substance.entity.ts; apps/api/src/modules/catalog/domain/errors/missing-substances.error.ts; +4 файлов |
| DTJ-094 | CategoryTreeService + GetCategoryTreeUseCase + GET /api/v1/categories | EP-04 | application | S | DTJ-091, DTJ-092 | apps/api/src/modules/catalog/domain/services/category-tree.service.ts; apps/api/src/modules/catalog/application/use-cases/get-category-tree.use-case.ts; apps/api/src/modules/catalog/presentation/controllers/categories.controller.ts; +3 файлов |
| DTJ-095 | GetMedicineDetailUseCase + GET /api/v1/medicines/:id | EP-04 | application | M | DTJ-092, DTJ-093, DTJ-101 | apps/api/src/modules/catalog/application/use-cases/get-medicine-detail.use-case.ts; apps/api/src/modules/catalog/presentation/controllers/medicines.controller.ts; apps/api/src/modules/catalog/presentation/dto/medicine-detail.dto.ts; +1 файлов |
| DTJ-096 | CatalogFacade — getMedicineSnapshot/getSubstances/isVisible + публикация доменных событий | EP-04 | application | M | DTJ-092, DTJ-093 | apps/api/src/modules/catalog/index.ts; apps/api/src/modules/catalog/application/use-cases/publish-medicine.use-case.ts; apps/api/src/modules/catalog/application/use-cases/propose-control-category.use-case.ts; +1 файлов |
| DTJ-097 | resolveMedicineByComposite — движок сопоставления по штрихкоду и trigram-fuzzy (D-06) | EP-04 | application | L | DTJ-092, DTJ-093, DTJ-096 | apps/api/src/modules/catalog/application/use-cases/resolve-medicine-by-composite.use-case.ts; apps/api/src/modules/catalog/application/services/dosage-form-normalizer.service.ts; apps/api/src/modules/catalog/infrastructure/adapters/fuzzy-medicine-matcher.adapter.ts; +3 файлов |
| DTJ-098 | Seed-данные каталога — ≥300 курированных позиций с корректными связями МНН/веществ | EP-04 | infrastructure | L | DTJ-091, DTJ-093 | db/seed/medicines/categories.seed.json; db/seed/medicines/substances.seed.json; db/seed/medicines/medicines.seed.json; +2 файлов |
| DTJ-099 | AnalogEquivalenceService — доменное решающее правило эквивалентности препаратов | EP-07 | domain | M | DTJ-090, DTJ-093 | apps/api/src/modules/catalog/domain/services/analog-equivalence.service.ts |
| DTJ-100 | AnalogCandidatesRepository — SQL-предфильтр кандидатов по множеству веществ (top-50) | EP-07 | infrastructure | S | DTJ-091, DTJ-092 | apps/api/src/modules/catalog/application/ports/analog-candidates.port.ts; apps/api/src/modules/catalog/infrastructure/adapters/analog-candidates.adapter.ts; apps/api/src/modules/catalog/catalog.module.ts |
| DTJ-101 | FindAnalogsUseCase — оркестрация подбора аналогов, расчёт экономии, AnalogOfferLookupPort | EP-07 | application | L | DTJ-096, DTJ-099, DTJ-100 | apps/api/src/modules/catalog/application/use-cases/find-analogs.use-case.ts; apps/api/src/modules/catalog/application/ports/analog-offer-lookup.port.ts; apps/api/src/modules/catalog/infrastructure/adapters/analog-offer-lookup.adapter.ts; +1 файлов |
| DTJ-102 | GET /api/v1/medicines/:id/analogs — контроллер, DTO, Rx-бейдж, дисклеймер | EP-07 | presentation | M | DTJ-101, DTJ-103 | apps/api/src/modules/catalog/presentation/controllers/analogs.controller.ts; apps/api/src/modules/catalog/presentation/dto/analog-result.dto.ts |
| DTJ-103 | i18n-контент блока аналогов (savings/neutral/disclaimer/rx-badge) + i18n_overrides.review_status | EP-07 | infrastructure | S | DTJ-091 | apps/api/migrations/0008_i18n_overrides_review_status.sql¹; apps/api/src/db/seed/i18n-overrides-catalog.seed.ts; packages/i18n/src/dictionaries/tj/catalog.json; +2 файлов |
| DTJ-104 | Frontend AnalogsBlock — плашка экономии, нейтральный заголовок, дисклеймер, Rx-бейдж | EP-07 | frontend | M | DTJ-102, DTJ-103 | apps/web/src/features/analogs/api/use-analogs-query.ts; apps/web/src/features/analogs/model/format-savings.ts; apps/web/src/features/analogs/ui/AnalogsBlock.tsx; +2 файлов |
| DTJ-140 | Создать scaffolding модуля inventory (4 слоя) и барабанный файл контрактов | EP-05 | infrastructure | L | — | apps/api/src/modules/inventory/domain/.gitkeep; apps/api/src/modules/inventory/application/use-cases/.gitkeep; apps/api/src/modules/inventory/application/ports/.gitkeep; +12 файлов |
| DTJ-141 | Drizzle-схема и baseline-миграция для основных таблиц inventory | EP-05 | infrastructure | M | DTJ-140 | apps/api/src/infrastructure/db/schema/inventory.schema.ts; apps/api/src/infrastructure/db/migrations/0007_inventory.sql |
| DTJ-142 | Миграция расширений схемы БД для синхронизации (Дополнения §10 модуля 22) | EP-05 | infrastructure | S | DTJ-141 | apps/api/src/infrastructure/db/schema/inventory.schema.ts; apps/api/src/infrastructure/db/migrations/0015a_inventory_sync_extensions.sql; apps/api/src/infrastructure/db/migrations/0015b_inventory_sync_enum_extension.sql² |
| DTJ-143 | Domain-сущность PharmacyInventory (агрегат остатка, FEFO, инварианты) | EP-05 | domain | M | DTJ-140 | apps/api/src/modules/inventory/domain/pharmacy-inventory.entity.ts; apps/api/src/modules/inventory/domain/pharmacy-inventory.entity.spec.ts |
| DTJ-144 | Domain-агрегат InventorySyncBatch + явная state machine статусов | EP-05 | domain | M | DTJ-140 | apps/api/src/modules/inventory/domain/inventory-sync-batch.entity.ts; apps/api/src/modules/inventory/domain/inventory-sync-batch.entity.spec.ts |
| DTJ-145 | VO InventoryBatchUpsertRow + каталог доменных ошибок inventory | EP-05 | domain | S | DTJ-140 | apps/api/src/modules/inventory/domain/inventory-batch-upsert-row.vo.ts; apps/api/src/modules/inventory/domain/errors/inventory.errors.ts; apps/api/src/modules/inventory/domain/inventory-batch-upsert-row.vo.spec.ts |
| DTJ-146 | CompositeInventoryMatcherService — штрихкод, кэш, точное совпадение (D-06 шаги 1-2) | EP-05 | application | M | DTJ-141, DTJ-145 | apps/api/src/modules/inventory/application/services/composite-inventory-matcher.service.ts; apps/api/src/modules/inventory/application/ports/pharmacy-sku-mapping.repository.port.ts; apps/api/src/modules/inventory/infrastructure/adapters/drizzle-pharmacy-sku-mapping.repository.ts; +1 файлов |
| DTJ-147 | CompositeInventoryMatcherService — trigram fuzzy + неоднозначность + очередь (D-06 шаги 3-4) | EP-05 | application | M | DTJ-146 | apps/api/src/modules/inventory/application/services/composite-inventory-matcher.service.ts; apps/api/src/modules/inventory/application/ports/inventory-outbox.port.ts; apps/api/src/modules/inventory/application/services/composite-inventory-matcher.service.spec.ts |
| DTJ-148 | IngestInventoryBatchUseCase — единая точка входа всех каналов | EP-05 | application | L | DTJ-143, DTJ-144, DTJ-145, DTJ-146, DTJ-147 | apps/api/src/modules/inventory/application/use-cases/ingest-inventory-batch.use-case.ts; apps/api/src/modules/inventory/application/ports/pharmacy-inventory.repository.port.ts; apps/api/src/modules/inventory/application/ports/inventory-sync-batch.repository.port.ts; +1 файлов |
| DTJ-149 | ResolveCatalogMatchQueueItemUseCase — ретроактивное применение резолюции очереди | EP-05 | application | S | DTJ-142, DTJ-143 | apps/api/src/modules/inventory/application/use-cases/resolve-catalog-match-queue-item.use-case.ts; apps/api/src/modules/inventory/application/ports/catalog-match-queue.repository.port.ts; apps/api/src/modules/inventory/application/use-cases/resolve-catalog-match-queue-item.use-case.spec.ts |
| DTJ-150 | RunNightlyFullSyncFanoutUseCase — ночной триггер полной синхронизации 03:00 | EP-05 | application | M | DTJ-141, DTJ-144 | apps/api/src/modules/inventory/application/use-cases/run-nightly-full-sync-fanout.use-case.ts; apps/api/src/modules/inventory/application/ports/pharmacy-api-key.read.port.ts; apps/api/src/modules/inventory/infrastructure/jobs/nightly-full-sync-fanout.cron.ts; +1 файлов |
| DTJ-151 | FullSyncCompletionService — обнуление отсутствующих позиций (§7.4) | EP-05 | application | M | DTJ-144, DTJ-148 | apps/api/src/modules/inventory/application/ports/full-sync-completion.port.ts; apps/api/src/modules/inventory/infrastructure/adapters/drizzle-full-sync-completion.adapter.ts; apps/api/src/modules/inventory/infrastructure/adapters/drizzle-full-sync-completion.adapter.integration.spec.ts |
| DTJ-152 | Watchdog зависших full-sync сессий (FULL_SYNC_SESSION_TIMEOUT_MINUTES) | EP-05 | application | S | DTJ-151 | apps/api/src/modules/inventory/application/use-cases/detect-stuck-full-sync-sessions.use-case.ts; apps/api/src/modules/inventory/infrastructure/jobs/full-sync-session-watchdog.cron.ts; apps/api/src/modules/inventory/application/use-cases/detect-stuck-full-sync-sessions.use-case.spec.ts |
| DTJ-153 | BullMQ-продюсер inventory-sync-queue через transactional outbox | EP-05 | infrastructure | S | DTJ-141, DTJ-144 | apps/api/src/modules/inventory/application/ports/inventory-sync-queue.port.ts; apps/api/src/modules/inventory/infrastructure/adapters/bullmq-inventory-sync-queue.adapter.ts; apps/api/src/modules/inventory/infrastructure/adapters/bullmq-inventory-sync-queue.adapter.spec.ts |
| DTJ-154 | InventorySyncBatchProcessor — BullMQ-воркер, advisory lock, COPY, set-based upsert | EP-05 | infrastructure | L | DTJ-148, DTJ-153, DTJ-141 | apps/api/src/modules/inventory/infrastructure/workers/inventory-sync-batch.processor.ts; apps/api/src/modules/inventory/infrastructure/adapters/drizzle-pharmacy-inventory.repository.ts; apps/worker/src/jobs/inventory-sync/inventory-sync.module.ts; +1 файлов |
| DTJ-155 | Обработчик исчерпания retry BullMQ — failed_validation + processing_failed | EP-05 | infrastructure | S | DTJ-154 | apps/api/src/modules/inventory/infrastructure/workers/inventory-sync-failed-job.handler.ts; apps/api/src/modules/inventory/infrastructure/workers/inventory-sync-failed-job.handler.spec.ts |
| DTJ-156 | PharmacyApiKeyGuard — HMAC-аутентификация 1С/ERP-канала (D-11) | EP-05 | presentation | M | DTJ-142 | apps/api/src/modules/inventory/presentation/guards/pharmacy-api-key.guard.ts; apps/api/src/modules/inventory/application/ports/pharmacy-api-key-verification.port.ts; apps/api/src/modules/inventory/infrastructure/adapters/drizzle-pharmacy-api-key-verification.adapter.ts; +1 файлов |
| DTJ-157 | POST /inventory/batch-update — контроллер REST-канала (немедленный ACK) | EP-05 | presentation | M | DTJ-140, DTJ-144, DTJ-156, DTJ-141 | packages/contracts/src/inventory/batch-update.schema.ts; apps/api/src/modules/inventory/presentation/controllers/inventory-batch-update.controller.ts; apps/api/src/modules/inventory/presentation/mappers/rest-inventory-request-to-command.mapper.ts; +1 файлов |
| DTJ-158 | GET /inventory-sync-batches/:batchId — статус батча для поллинга 1С | EP-05 | presentation | XS | DTJ-157 | packages/contracts/src/inventory/sync-batches.schema.ts; apps/api/src/modules/inventory/presentation/controllers/inventory-sync-batch-status.controller.ts; apps/api/src/modules/inventory/presentation/controllers/inventory-sync-batch-status.controller.spec.ts |
| DTJ-159 | GET /inventory-import-template — шаблон Excel/CSV для аптек без автоматизации | EP-05 | presentation | S | DTJ-140 | apps/api/src/modules/inventory/presentation/controllers/inventory-import-template.controller.ts; apps/api/src/modules/inventory/presentation/controllers/inventory-import-template.controller.spec.ts |
| DTJ-160 | XlsxExcelInventoryParserAdapter — парсинг Excel/CSV по заголовку колонки | EP-05 | infrastructure | M | DTJ-140, DTJ-159 | apps/api/src/modules/inventory/application/ports/excel-inventory-parser.port.ts; apps/api/src/modules/inventory/infrastructure/adapters/xlsx-excel-inventory-parser.adapter.ts; apps/api/src/modules/inventory/infrastructure/adapters/xlsx-excel-inventory-parser.adapter.spec.ts |
| DTJ-161 | POST /inventory-excel-import — контроллер загрузки, разбивка на батчи, sourceUploadId | EP-05 | presentation | M | DTJ-157, DTJ-160 | packages/contracts/src/inventory/excel-import.schema.ts; apps/api/src/modules/inventory/presentation/controllers/inventory-excel-import.controller.ts; apps/api/src/modules/inventory/presentation/mappers/excel-inventory-request-to-command.mapper.ts; +1 файлов |
| DTJ-162 | POST /inventory-manual-entry — точечный и массовый ручной ввод (синхронный путь) | EP-05 | presentation | M | DTJ-140, DTJ-148 | packages/contracts/src/inventory/manual-entry.schema.ts; apps/api/src/modules/inventory/presentation/controllers/inventory-manual-entry.controller.ts; apps/api/src/modules/inventory/presentation/mappers/manual-entry-request-to-command.mapper.ts; +1 файлов |
| DTJ-163 | GET /admin/inventory-sync-batches + /:id/errors — отчёт для кабинета аптеки | EP-05 | presentation | S | DTJ-144, DTJ-157 | packages/contracts/src/inventory/sync-batches.schema.ts; apps/api/src/modules/inventory/presentation/controllers/inventory-sync-batches-report.controller.ts; apps/api/src/modules/inventory/presentation/controllers/inventory-sync-batches-report.controller.spec.ts |
| DTJ-164 | GET /inventory-sync-batches/:sourceUploadId/error-report — скачивание отчёта об ошибках Excel | EP-05 | presentation | S | DTJ-160, DTJ-163 | apps/api/src/modules/inventory/presentation/controllers/inventory-excel-error-report.controller.ts; apps/api/src/modules/inventory/presentation/controllers/inventory-excel-error-report.controller.spec.ts |
| DTJ-165 | CommerceMlParserPort + MockCommerceMlParserAdapter (R1 — порт и мок, без реального XML-парсера) | EP-05 | infrastructure | S | DTJ-140 | apps/api/src/modules/inventory/application/ports/commerce-ml-parser.port.ts; apps/api/src/modules/inventory/infrastructure/adapters/mock-commerce-ml-parser.adapter.ts; apps/api/src/modules/inventory/infrastructure/adapters/mock-commerce-ml-parser.adapter.spec.ts |
| DTJ-166 | Scaffolding apps/pharmacy — первый экран кабинета аптеки (shell, роутер, авторизация) | EP-05 | frontend | L | DTJ-140 | apps/pharmacy/package.json; apps/pharmacy/vite.config.ts; apps/pharmacy/index.html; +7 файлов |
| DTJ-167 | Экран /inventory — точечное редактирование остатка (каталожный автокомплит) | EP-05 | frontend | M | DTJ-166, DTJ-162 | apps/pharmacy/src/features/inventory-manual/api/use-manual-entry.ts; apps/pharmacy/src/features/inventory-manual/model/manual-entry-form.model.ts; apps/pharmacy/src/features/inventory-manual/ui/MedicineAutocomplete.tsx; +2 файлов |
| DTJ-168 | Экран /inventory — массовая сетка + импорт Excel/CSV с прогресс-баром | EP-05 | frontend | L | DTJ-166, DTJ-161, DTJ-159, DTJ-164 | apps/pharmacy/src/features/inventory-bulk/api/use-bulk-grid.ts; apps/pharmacy/src/features/inventory-bulk/api/use-excel-import.ts; apps/pharmacy/src/features/inventory-bulk/ui/BulkEditGrid.tsx; +3 файлов |
| DTJ-169 | Экран /inventory/sync-history — история синхронизаций всех каналов | EP-05 | frontend | M | DTJ-166, DTJ-163 | apps/pharmacy/src/features/sync-history/api/use-sync-batches.ts; apps/pharmacy/src/features/sync-history/ui/SyncBatchesTable.tsx; apps/pharmacy/src/features/sync-history/ui/BatchErrorsAccordion.tsx; +2 файлов |
| DTJ-170 | k6-нагрузочный тест inventory-sync — 500 item-events/сек, burst 2000/сек (D-05) | EP-05 | tests | M | DTJ-154, DTJ-157 | tests/load/inventory-sync.k6.js; tests/load/fixtures/inventory-sync-pharmacies.seed.ts; tests/load/README-inventory-sync.md |
| DTJ-171 | GET /inventory — список текущих остатков аптеки для сетки массового редактирования | EP-05 | presentation | M | DTJ-162, DTJ-168 | packages/contracts/src/inventory/pharmacy-inventory-list.schema.ts; apps/api/src/modules/inventory/application/use-cases/list-pharmacy-inventory.use-case.ts; apps/api/src/modules/inventory/presentation/controllers/inventory-list.controller.ts; +5 файлов |
| DTJ-180 | Создать SearchProvider-порт, скелет модуля поиска и контракты search.ts | EP-06 | application | S | — | apps/api/src/modules/catalog/application/search/ports/search-provider.port.ts; apps/api/src/modules/catalog/application/search/providers/null-search.provider.ts; apps/api/src/modules/catalog/catalog.module.ts; +2 файлов |
| DTJ-181 | Миграции БД для поиска — pharmacy_reliability_scores, search_query_log, префиксный индекс | EP-06 | infrastructure | S | — | apps/api/migrations/0xxx_search_schema_additions.sql; apps/api/src/db/schema/pharmacy-reliability-scores.schema.ts; apps/api/src/db/schema/search-query-log.schema.ts; +1 файлов |
| DTJ-182 | Реализовать QueryNormalizationService (штрихкод, транслит, схлопывание пробелов) | EP-06 | domain | M | DTJ-180 | apps/api/src/modules/catalog/domain/services/query-normalization.service.ts; apps/api/src/modules/catalog/domain/services/transliteration-normalizer.service.ts; packages/i18n/translit-map.json |
| DTJ-183 | Реализовать RankingScoreMapper — доменная формула ранжирования и перенормировка весов | EP-06 | domain | M | DTJ-180 | apps/api/src/modules/catalog/domain/services/ranking-score-mapper.service.ts |
| DTJ-184 | Реализовать PharmacyOpeningHoursPolicy — фильтры «открыто сейчас» и «24/7» | EP-06 | application | S | DTJ-180 | apps/api/src/modules/catalog/application/services/pharmacy-opening-hours.policy.ts; apps/api/src/modules/catalog/application/ports/clock.port.ts |
| DTJ-185 | Реализовать PostgresSearchProvider.search() — композитный SQL-запрос ранжирования | EP-06 | infrastructure | L | DTJ-180, DTJ-181, DTJ-182, DTJ-183 | apps/api/src/modules/catalog/infrastructure/adapters/postgres-search.adapter.ts; apps/api/src/modules/catalog/infrastructure/adapters/postgres-search.sql.ts; apps/api/src/modules/catalog/catalog.module.ts |
| DTJ-186 | Реализовать PostgresSearchProvider.suggest() — автодополнение (префикс/триграмма/дедуп) | EP-06 | infrastructure | M | DTJ-180, DTJ-181 | apps/api/src/modules/catalog/infrastructure/adapters/postgres-search.adapter.ts; apps/api/src/modules/catalog/infrastructure/adapters/postgres-suggest.sql.ts |
| DTJ-187 | Redis-кэширование поиска/автодополнения/trending и защита от cache stampede | EP-06 | infrastructure | M | DTJ-180, DTJ-181 | apps/api/src/modules/catalog/infrastructure/cache/search-cache.service.ts; apps/api/src/modules/catalog/infrastructure/cache/redis-lock-guard.ts |
| DTJ-188 | Реализовать SearchMedicinesUseCase — оркестрация поиска end-to-end | EP-06 | application | M | DTJ-182, DTJ-183, DTJ-184, DTJ-185, DTJ-187 | apps/api/src/modules/catalog/application/use-cases/search-medicines.use-case.ts |
| DTJ-189 | Реализовать SuggestMedicinesUseCase — автодополнение с cold-start историей/trending | EP-06 | application | S | DTJ-186, DTJ-187 | apps/api/src/modules/catalog/application/use-cases/suggest-medicines.use-case.ts |
| DTJ-190 | Контроллер поиска — GET /medicines/search и GET /medicines/suggest | EP-06 | presentation | S | DTJ-188, DTJ-189 | apps/api/src/modules/catalog/presentation/controllers/catalog-search.controller.ts; apps/api/src/modules/catalog/presentation/mappers/search-result.mapper.ts |
| DTJ-191 | Заготовка ElasticSearchProvider + SearchProviderCircuitBreaker (R2, форвард-совместимость) | EP-06 | infrastructure | M | DTJ-180 | apps/api/src/modules/catalog/infrastructure/adapters/elasticsearch-search.adapter.ts; apps/api/src/modules/catalog/infrastructure/resilience/search-provider-circuit-breaker.ts |
| DTJ-192 | Frontend: SearchBar с автодополнением, debounce, историей и главным экраном | EP-06 | frontend | M | DTJ-190 | apps/web/src/features/search/ui/search-bar.tsx; apps/web/src/features/search/ui/suggest-dropdown.tsx; apps/web/src/features/search/model/use-search-suggestions.ts; +2 файлов |
| DTJ-193 | Frontend: экран результатов поиска — фильтры, сортировка, список, состояния | EP-06 | frontend | L | DTJ-190, DTJ-192 | apps/web/src/features/search/ui/search-results-page.tsx; apps/web/src/features/search/ui/search-filters.tsx; apps/web/src/features/search/ui/search-sort-tabs.tsx; +4 файлов |
| DTJ-194 | Scaffolding: контракты и порт репозитория карты аптек (pharmacies-map) | EP-08 | application | XS | — | apps/api/src/modules/catalog/application/pharmacies-map/ports/pharmacy-map-repository.port.ts; packages/contracts/src/pharmacies-map.ts; packages/contracts/src/index.ts |
| DTJ-195 | Реализовать PostgresPharmacyMapRepository — bbox-запрос пинов аптек | EP-08 | infrastructure | M | DTJ-194 | apps/api/src/modules/catalog/infrastructure/adapters/postgres-pharmacy-map.adapter.ts |
| DTJ-196 | Реализовать GetPharmacyMapPinsUseCase — валидация bbox и обогащение «открыто сейчас» | EP-08 | application | S | DTJ-194, DTJ-195, DTJ-184 | apps/api/src/modules/catalog/application/use-cases/get-pharmacy-map-pins.use-case.ts |
| DTJ-197 | Контроллер карты — GET /api/v1/pharmacies/map | EP-08 | presentation | XS | DTJ-196 | apps/api/src/modules/catalog/presentation/controllers/pharmacy-map.controller.ts; apps/api/src/modules/catalog/presentation/mappers/pharmacy-map.mapper.ts |
| DTJ-198 | Frontend: обёртка MapView на MapLibre GL JS с self-hosted vector-тайлами | EP-08 | frontend | M | DTJ-194 | apps/web/src/features/pharmacy-map/ui/map-view.tsx; apps/web/src/features/pharmacy-map/model/use-map-viewport.ts |
| DTJ-199 | Frontend: экран /map — карта аптек, фильтры, точки входа с главного экрана и карточки товара | EP-08 | frontend | L | DTJ-197, DTJ-198 | apps/web/src/pages/map/index.tsx; apps/web/src/features/pharmacy-map/ui/pharmacy-map-page.tsx; apps/web/src/features/pharmacy-map/ui/pharmacy-preview-card.tsx; +2 файлов |
| DTJ-220 | Скаффолдинг модуля orders — миграция Group D, каркас модуля, контракты | EP-09 | infrastructure | M | — | apps/api/migrations/0008_orders_cart.sql; apps/api/src/db/schema/orders.ts; apps/api/src/db/schema/cart.ts; +11 файлов |
| DTJ-221 | Order/OrderItem: доменная сущность и инварианты создания | EP-09 | domain | M | DTJ-220 | apps/api/src/modules/orders/domain/order.entity.ts; apps/api/src/modules/orders/domain/order-item.entity.ts; apps/api/src/modules/orders/domain/order-number.vo.ts; +9 файлов |
| DTJ-222 | Order: полная state machine переходов статусов (вкл. D-25 confirmed) и публичный фасад | EP-09 | domain | L | DTJ-221 | apps/api/src/modules/orders/domain/order.state-machine.ts; apps/api/src/modules/orders/domain/errors/invalid-order-status-transition.error.ts; apps/api/src/modules/orders/domain/errors/expired-stock.error.ts; +2 файлов |
| DTJ-223 | Cart: управление позициями и мультиаптечная группировка | EP-09 | application | M | DTJ-220 | apps/api/src/modules/orders/application/cart/add-cart-item.use-case.ts; apps/api/src/modules/orders/application/cart/update-cart-item-quantity.use-case.ts; apps/api/src/modules/orders/application/cart/remove-cart-item.use-case.ts; +3 файлов |
| DTJ-224 | Cart: мягкий резерв остатка (Redis TTL) и AvailabilityCalculator | EP-09 | application | M | DTJ-223 | apps/api/src/modules/orders/application/cart/availability-calculator.service.ts; apps/api/src/modules/orders/application/cart/extend-cart-hold.use-case.ts; apps/api/src/modules/orders/application/ports/cart-hold-store.port.ts; +2 файлов |
| DTJ-225 | Cart: живой пересчёт цены/остатка при просмотре и предупреждения | EP-09 | application | S | DTJ-223, DTJ-224 | apps/api/src/modules/orders/application/cart/get-cart.use-case.ts; apps/api/src/modules/orders/application/cart/dto/cart-view.dto.ts |
| DTJ-226 | Cart: REST API, merge гостевой корзины при логине | EP-09 | presentation | M | DTJ-223, DTJ-224, DTJ-225 | apps/api/src/modules/orders/presentation/cart/cart.controller.ts; apps/api/src/modules/orders/presentation/cart/dto/cart-item-request.dto.ts; apps/api/src/modules/orders/application/cart/merge-guest-cart.use-case.ts |
| DTJ-227 | CheckoutUseCase: оркестрация, сплит по аптекам, частичный успех | EP-09 | application | L | DTJ-220, DTJ-221, DTJ-222, DTJ-223 | apps/api/src/modules/orders/application/checkout/checkout.use-case.ts; apps/api/src/modules/orders/application/checkout/dto/checkout-command.dto.ts; apps/api/src/modules/orders/application/checkout/dto/checkout-result.dto.ts; +2 файлов |
| DTJ-228 | Checkout: расчёт стоимости, снэпшот комиссии, billing_strategy | EP-09 | application | M | DTJ-220, DTJ-221, DTJ-227 | apps/api/src/modules/orders/application/checkout/calculate-order-cost.service.ts; apps/api/src/modules/orders/application/checkout/resolve-billing-strategy.service.ts; apps/api/migrations/0020_orders_payments_extensions.sql |
| DTJ-229 | Checkout: адрес/ориентир и валидация способа оплаты (COD-политика) | EP-09 | application | M | DTJ-220, DTJ-227 | apps/api/src/modules/orders/application/checkout/resolve-delivery-address.service.ts; apps/api/src/modules/orders/application/policies/cod-policy.service.ts; apps/api/src/modules/orders/application/checkout/errors/payment-method-not-enabled.error.ts |
| DTJ-230 | Checkout: Rx-исключение позиций и синхронный confirm для cash_courier (D-25) | EP-09 | application | M | DTJ-222, DTJ-227 | apps/api/src/modules/orders/application/checkout/exclude-unverified-rx-items.service.ts; apps/api/src/modules/orders/application/checkout/errors/no-orderable-items.error.ts |
| DTJ-231 | Checkout: идемпотентность и конкурентность (гонки, дрейф цены, двойной клик) | EP-09 | application | M | DTJ-227, DTJ-228, DTJ-229, DTJ-230 | apps/api/src/modules/orders/application/checkout/detect-price-drift.service.ts; apps/api/src/modules/orders/application/checkout/errors/price-or-stock-changed.error.ts |
| DTJ-232 | CancelOrderUseCase — отмена заказа по всем веткам жизненного цикла | EP-09 | application | M | DTJ-222 | apps/api/src/modules/orders/application/order-lifecycle/cancel-order.use-case.ts; apps/api/src/modules/orders/application/order-lifecycle/dto/cancel-order-command.dto.ts; apps/api/src/modules/orders/application/ports/refund-facade.port.ts |
| DTJ-233 | Checkout: REST-эндпоинты POST /orders, POST /orders/:id/cancel, маппинг ошибок | EP-09 | presentation | M | DTJ-227, DTJ-228, DTJ-229, DTJ-230, DTJ-231, DTJ-232 | apps/api/src/modules/orders/presentation/checkout/checkout.controller.ts; apps/api/src/modules/orders/presentation/checkout/dto/create-order-request.dto.ts; apps/api/src/modules/orders/presentation/checkout/dto/order-response.dto.ts |
| DTJ-234 | Frontend: экран корзины (apps/web/features/cart) | EP-09 | frontend | M | DTJ-226 | apps/web/src/features/cart/api/use-cart.ts; apps/web/src/features/cart/api/use-cart-mutations.ts; apps/web/src/features/cart/model/group-warnings.ts; +4 файлов |
| DTJ-235 | Frontend: экран оформления заказа (apps/web/features/checkout) | EP-09 | frontend | M | DTJ-233, DTJ-234 | apps/web/src/features/checkout/api/use-create-order.ts; apps/web/src/features/checkout/model/checkout-form.model.ts; apps/web/src/features/checkout/ui/CheckoutScreen.tsx; +4 файлов |
| DTJ-236 | Скаффолдинг модуля payments — миграция Group E, каркас модуля, контракты | EP-10 | infrastructure | M | — | apps/api/migrations/0009_payments.sql; apps/api/src/db/schema/payments.ts; apps/api/src/modules/payments/payments.module.ts; +5 файлов |
| DTJ-237 | PaymentProvider: порт и общие типы | EP-10 | application | S | DTJ-236 | apps/api/src/modules/payments/application/ports/payment-provider.port.ts; apps/api/src/modules/payments/application/ports/bank-webhook-verifier.port.ts; apps/api/src/modules/payments/domain/errors/payment-provider.error.ts; +1 файлов |
| DTJ-238 | MockBankProvider: детерминированный адаптер + авто-вебхук | EP-10 | infrastructure | M | DTJ-237 | apps/api/src/modules/payments/infrastructure/adapters/mock-bank.provider.ts; apps/api/src/modules/payments/infrastructure/adapters/mock-bank-webhook-verifier.adapter.ts; apps/worker/src/jobs/escrow-timeouts/mock-bank-auto-pay.job.ts; +1 файлов |
| DTJ-239 | AlifMobiProvider/DcNextProvider: заготовки адаптеров (R3, порт готов R1) | EP-10 | infrastructure | S | DTJ-237, DTJ-238 | apps/api/src/modules/payments/infrastructure/adapters/alif-mobi.provider.ts; apps/api/src/modules/payments/infrastructure/adapters/dc-next.provider.ts; apps/api/src/modules/payments/infrastructure/adapters/alif-mobi-webhook-verifier.adapter.ts; +1 файлов |
| DTJ-240 | EscrowLedger: доменный агрегат двойной записи (append-only) | EP-10 | domain | S | DTJ-236 | apps/api/src/modules/payments/domain/escrow-ledger.entity.ts; apps/api/src/modules/payments/domain/escrow-ledger-entry.value-object.ts; apps/api/src/modules/payments/domain/errors/adjustment-requires-reason.error.ts; +1 файлов |
| DTJ-241 | CreatePaymentInvoiceUseCase — реализация PaymentInvoicePort + retry-payment | EP-10 | application | M | DTJ-227, DTJ-236, DTJ-238 | apps/api/src/modules/payments/application/use-cases/create-payment-invoice.use-case.ts; apps/api/src/modules/payments/infrastructure/adapters/payment-invoice.adapter.ts; apps/api/src/modules/payments/presentation/retry-payment.controller.ts |
| DTJ-242 | HandlePaymentWebhookUseCase — HMAC → идемпотентность → markPaidEscrow + recordHold | EP-10 | application | L | DTJ-222, DTJ-236, DTJ-237, DTJ-238, DTJ-240 | apps/api/src/modules/payments/application/use-cases/handle-payment-webhook.use-case.ts; apps/api/src/modules/payments/presentation/webhook/payments-webhook.controller.ts; apps/api/src/modules/payments/infrastructure/adapters/orders-facade.adapter.ts |
| DTJ-243 | Webhook: пограничные случаи (неизвестный платёж, out-of-order, поздняя оплата) | EP-10 | application | M | DTJ-242 | apps/api/src/modules/payments/application/use-cases/handle-payment-webhook.use-case.ts; apps/api/src/modules/payments/application/services/late-payment-refund.service.ts |
| DTJ-244 | CaptureEscrowUseCase — захват комиссии/выплаты аптеке при доставке, NOOP для cash | EP-10 | application | M | DTJ-236, DTJ-240, DTJ-242 | apps/api/src/modules/payments/application/use-cases/capture-escrow.use-case.ts; apps/api/src/modules/payments/infrastructure/subscribers/order-delivered.subscriber.ts |
| DTJ-245 | RefundOrderUseCase — полный рефанд, реализация RefundFacadePort, NOOP для cash | EP-10 | application | M | DTJ-236, DTJ-237, DTJ-240 | apps/api/src/modules/payments/application/use-cases/refund-order.use-case.ts; apps/api/src/modules/payments/infrastructure/adapters/refund-facade.adapter.ts |
| DTJ-246 | AdjustLedgerUseCase + AdminPaymentOverrideUseCase — контролируемые исключения | EP-10 | application | M | DTJ-240, DTJ-242 | apps/api/src/modules/payments/application/use-cases/adjust-ledger.use-case.ts; apps/api/src/modules/payments/application/use-cases/admin-payment-override.use-case.ts; apps/api/src/modules/payments/presentation/admin-payment-override.controller.ts |
| DTJ-247 | EscrowReconciliationJob — ежедневная сверка инварианта ledger | EP-10 | infrastructure | S | DTJ-240 | apps/worker/src/jobs/payout/escrow-reconciliation.job.ts; apps/api/src/modules/payments/infrastructure/metrics/escrow-ledger-imbalance.metric.ts |
| DTJ-248 | GET /orders/:id/ledger — API поверх эскроу-леджера с ролевой видимостью | EP-10 | presentation | M | DTJ-240 | apps/api/src/modules/payments/presentation/ledger/get-order-ledger.controller.ts; apps/api/src/modules/payments/application/queries/get-order-ledger.query.ts |
| DTJ-249 | PayoutSchedulerJob (pending→due) + контракт заморозки по спору | EP-10 | application | S | DTJ-244 | apps/worker/src/jobs/payout/payout-scheduler.job.ts; apps/api/src/modules/payments/application/ports/payments-facade.port.ts; apps/api/src/modules/payments/application/use-cases/hold-payout.use-case.ts |
| DTJ-250 | BankPayoutTransferPort + Mock + PayoutExecutionJob (due→paid) | EP-10 | infrastructure | M | DTJ-249 | apps/api/src/modules/payments/application/ports/bank-payout-transfer.port.ts; apps/api/src/modules/payments/infrastructure/adapters/mock-bank-payout-transfer.provider.ts; apps/worker/src/jobs/payout/payout-execution.job.ts |
| DTJ-251 | CashCommissionAggregationJob — B2B-инвойс комиссии за cash_courier | EP-10 | application | M | DTJ-236, DTJ-244 | apps/worker/src/jobs/payout/cash-commission-aggregation.job.ts; apps/api/src/modules/payments/infrastructure/repositories/platform-billing-invoice.repository.ts |
| DTJ-252 | Просрочка B2B-инвойса → авто-блокировка сети + отчёты аптеке | EP-10 | application | M | DTJ-251 | apps/worker/src/jobs/payout/billing-invoice-overdue.job.ts; apps/api/src/modules/payments/presentation/pharmacy-accounts-reports/get-payouts.controller.ts; apps/api/src/modules/payments/presentation/pharmacy-accounts-reports/get-billing-invoices.controller.ts; +1 файлов |
| DTJ-253 | UnpaidOrderTimeoutJob — авто-отмена неоплаченного non-cash заказа | EP-10 | infrastructure | S | DTJ-222, DTJ-228 | apps/worker/src/jobs/escrow-timeouts/unpaid-order-timeout.job.ts |
| DTJ-254 | PickupSlaTimeoutJob — авто-отмена несобранного заказа (обе ветки: cash и non-cash) | EP-10 | infrastructure | S | DTJ-222, DTJ-245 | apps/worker/src/jobs/escrow-timeouts/pickup-sla-timeout.job.ts |
| DTJ-255 | EscrowInvariantSpec — сквозной гейт-тест инварианта D-25 (SRS-ORD-027a/SRS-DOM-180) | EP-10 | tests | S | DTJ-222, DTJ-240, DTJ-242 | tests/invariants/escrow-invariant.spec.ts |
| DTJ-270 | Скаффолдинг модулей returns/support — миграция схемы, каркас модулей, контракты | EP-11 | infrastructure | M | — | apps/api/migrations/0010_returns_disputes_support.sql; apps/api/src/db/schema/returns.ts; apps/api/src/db/schema/support.ts; +11 файлов |
| DTJ-271 | Доменная сущность OrderReturn — инварианты и state machine | EP-11 | domain | M | DTJ-270 | apps/api/src/modules/returns/domain/order-return.entity.ts; apps/api/src/modules/returns/domain/value-objects/return-reason.vo.ts; apps/api/src/modules/returns/domain/value-objects/return-disposition.vo.ts; +5 файлов |
| DTJ-272 | ReturnFinancialOutcomeResolver — политика «вина → денежный исход» | EP-11 | application | S | DTJ-271 | apps/api/src/modules/returns/application/policies/return-financial-outcome.policy.ts; apps/api/src/modules/returns/application/policies/return-financial-outcome.types.ts |
| DTJ-273 | Use case'ы жизненного цикла возврата — request/markInTransit/confirm/reject/override/retry | EP-11 | application | L | DTJ-270, DTJ-271 | apps/api/src/modules/returns/application/use-cases/request-return.use-case.ts; apps/api/src/modules/returns/application/use-cases/mark-return-in-transit.use-case.ts; apps/api/src/modules/returns/application/use-cases/confirm-return-received.use-case.ts; +8 файлов |
| DTJ-274 | RefundOnReturnResolvedUseCase — рефанд по возврату с учётом стратегии раздельного биллинга | EP-11 | application | M | DTJ-270, DTJ-272, DTJ-273 | apps/api/src/modules/returns/application/use-cases/refund-on-return-resolved.use-case.ts; apps/api/src/modules/returns/application/use-cases/refund-on-return-resolved.subscriber.ts |
| DTJ-275 | REST API возвратов — 7 эндпоинтов, RBAC, идемпотентность | EP-11 | presentation | M | DTJ-273, DTJ-274 | apps/api/src/modules/returns/presentation/order-returns.controller.ts; apps/api/src/modules/returns/presentation/dto/request-return.dto.ts; apps/api/src/modules/returns/presentation/dto/mark-in-transit.dto.ts; +7 файлов |
| DTJ-276 | apps/web — экран запроса возврата и отслеживания статуса | EP-11 | frontend | M | DTJ-275 | apps/web/src/features/order-returns/api/use-request-return.ts; apps/web/src/features/order-returns/api/use-return-details.ts; apps/web/src/features/order-returns/model/return-reason-options.ts; +6 файлов |
| DTJ-277 | apps/pharmacy — приёмка возврата фармацевтом (чек-лист, confirm/reject) | EP-11 | frontend | M | DTJ-275 | apps/pharmacy/src/features/returns/api/use-incoming-returns.ts; apps/pharmacy/src/features/returns/api/use-confirm-return.ts; apps/pharmacy/src/features/returns/api/use-reject-return.ts; +6 файлов |
| DTJ-278 | Доменная сущность SupportTicket — состояние, SLA-поля, миграция расширения | EP-14 | domain | M | DTJ-270 | apps/api/migrations/0011_support_ticket_sla_fields.sql; apps/api/src/modules/support/domain/support-ticket.entity.ts; apps/api/src/modules/support/domain/support-ticket-message.entity.ts; +5 файлов |
| DTJ-279 | CreateSupportTicketUseCase — создание обращения с гардом is_escrow_blocking | EP-14 | application | S | DTJ-278 | apps/api/src/modules/support/application/use-cases/create-support-ticket.use-case.ts; apps/api/src/modules/support/application/ports/support-tickets-repository.port.ts; apps/api/src/modules/support/application/ports/support-orders-facade.port.ts; +1 файлов |
| DTJ-280 | SupportSlaMonitorJob — эскалация просроченного первого ответа | EP-14 | infrastructure | S | DTJ-278, DTJ-279 | apps/worker/src/jobs/support-sla-monitor/support-sla-monitor.job.ts; apps/worker/src/jobs/support-sla-monitor/support-sla-monitor.scheduler.ts; apps/api/src/modules/support/application/use-cases/escalate-ticket-priority.use-case.ts |
| DTJ-281 | SupportFacade — публичный фасад модуля + авто-создание тикета по просрочке SLA доставки | EP-14 | application | S | DTJ-278, DTJ-279, DTJ-280 | apps/api/src/modules/support/index.ts; apps/api/src/modules/support/application/use-cases/create-auto-support-ticket.use-case.ts; apps/api/src/modules/support/application/support-tickets.policy.ts |
| DTJ-282 | REST API обращений поддержки — создание, список, ответ, резолюция | EP-14 | presentation | M | DTJ-278, DTJ-279, DTJ-281 | apps/api/src/modules/support/presentation/support-tickets.controller.ts; apps/api/src/modules/support/presentation/dto/create-support-ticket.dto.ts; apps/api/src/modules/support/presentation/dto/add-message.dto.ts; +5 файлов |
| DTJ-283 | apps/admin — очередь обращений поддержки (список, деталь, SLA-индикация) | EP-14 | frontend | M | DTJ-282 | apps/admin/src/features/support/api/use-support-tickets.ts; apps/admin/src/features/support/api/use-support-ticket-detail.ts; apps/admin/src/features/support/api/use-respond-ticket.ts; +8 файлов |
| DTJ-284 | apps/web — создание обращения в поддержку и отслеживание клиентом | EP-14 | frontend | S | DTJ-282 | apps/web/src/features/support/api/use-create-ticket.ts; apps/web/src/features/support/api/use-my-tickets.ts; apps/web/src/features/support/ui/ContactSupportButton.tsx; +5 файлов |
| DTJ-285 | Реальный ReturnsPaymentsPort — рефанд по возврату через payments | EP-11 | infrastructure | M | DTJ-274, DTJ-032 | apps/api/src/modules/returns/infrastructure/adapters/payments-facade.adapter.ts; apps/api/src/modules/returns/returns.module.ts; +2 файлов |
| DTJ-300 | Схема БД и доменные расширения терминала фармацевта (scaffolding) | EP-12 | domain | M | — | apps/api/migrations/00xx_pharmacy_terminal_schema.sql; apps/api/src/db/schema/orders.ts; apps/api/src/db/schema/order-partial-fulfillment-requests.ts; +15 файлов |
| DTJ-301 | Очередь заказов терминала, приёмка (accept) и перехват (reclaim) | EP-12 | application | M | DTJ-300 | apps/api/src/modules/orders/application/pharmacy-terminal/get-order-queue.use-case.ts; apps/api/src/modules/orders/application/pharmacy-terminal/accept-order.use-case.ts; apps/api/src/modules/orders/application/pharmacy-terminal/reclaim-order.use-case.ts; +3 файлов |
| DTJ-302 | Сканирование позиции заказа и партийная замена (scan) | EP-12 | application | L | DTJ-300 | apps/api/src/modules/orders/application/pharmacy-terminal/scan-order-item.use-case.ts; apps/api/src/modules/orders/application/ports/inventory-facade.port.ts; apps/api/src/modules/orders/presentation/pharmacy-terminal/pharmacy-terminal-items.controller.ts |
| DTJ-303 | Сообщение о недоступности позиции (report-issue) | EP-12 | application | S | DTJ-300 | apps/api/src/modules/orders/application/pharmacy-terminal/report-item-issue.use-case.ts; apps/api/src/modules/orders/presentation/pharmacy-terminal/pharmacy-terminal-items.controller.ts |
| DTJ-304 | Частичная сборка — предложение и подтверждение клиентом | EP-12 | application | L | DTJ-300, DTJ-303 | apps/api/src/modules/orders/application/pharmacy-terminal/propose-partial-fulfillment.use-case.ts; apps/api/src/modules/orders/application/pharmacy-terminal/resolve-partial-fulfillment.use-case.ts; apps/api/src/modules/orders/infrastructure/jobs/partial-fulfillment-timeout.processor.ts; +1 файлов |
| DTJ-305 | Завершение сборки и передача курьеру (complete-picking) | EP-12 | application | M | DTJ-300, DTJ-302, DTJ-304 | apps/api/src/modules/orders/application/pharmacy-terminal/complete-picking.use-case.ts; apps/api/src/modules/orders/presentation/pharmacy-terminal/complete-picking.controller.ts |
| DTJ-306 | OTP вручения — просмотр и регенерация | EP-12 | application | S | DTJ-300, DTJ-305 | apps/api/src/modules/orders/application/pharmacy-terminal/get-handover-otp.use-case.ts; apps/api/src/modules/orders/application/pharmacy-terminal/regenerate-handover-otp.use-case.ts; apps/api/src/modules/orders/presentation/pharmacy-terminal/handover-otp.controller.ts |
| DTJ-307 | SLA-таймер сборки — мягкая эскалация и жёсткий автоотказ | EP-12 | infrastructure | M | DTJ-300, DTJ-301 | apps/api/src/modules/orders/infrastructure/jobs/sla-watchdog.processor.ts; apps/api/src/modules/orders/application/pharmacy-terminal/schedule-sla-watchdog.use-case.ts |
| DTJ-308 | Realtime-события терминала фармацевта (WS) | EP-12 | presentation | S | DTJ-301, DTJ-304, DTJ-305 | apps/api/src/modules/orders/infrastructure/realtime/pharmacy-terminal-events.publisher.ts |
| DTJ-309 | RBAC и межтенантная изоляция — сквозные интеграционные тесты терминала фармацевта | EP-12 | tests | M | DTJ-301, DTJ-302, DTJ-303, DTJ-304, DTJ-305, DTJ-306 | apps/api/test/integration/pharmacy-terminal/rbac-isolation.spec.ts; apps/api/test/integration/pharmacy-terminal/idempotency.spec.ts |
| DTJ-310 | apps/pharmacy: экран очереди заказов (Order Queue) + звуковое/визуальное оповещение | EP-12 | frontend | M | DTJ-301, DTJ-307, DTJ-308 | apps/pharmacy/src/features/order-fulfillment/order-queue/**; apps/pharmacy/src/features/order-fulfillment/api/orders-queue.api.ts; apps/pharmacy/src/features/order-fulfillment/model/order-queue.model.ts |
| DTJ-311 | apps/pharmacy: экран сборки — ручной ввод штрихкода и сообщение о проблеме | EP-12 | frontend | L | DTJ-302, DTJ-303, DTJ-310 | apps/pharmacy/src/features/order-fulfillment/picking/**; apps/pharmacy/src/features/order-fulfillment/api/order-items.api.ts; apps/pharmacy/src/features/order-fulfillment/model/picking.model.ts |
| DTJ-312 | apps/pharmacy: частичная сборка, завершение сборки и экран OTP вручения | EP-12 | frontend | M | DTJ-304, DTJ-305, DTJ-306, DTJ-311 | apps/pharmacy/src/features/order-fulfillment/partial-fulfillment/**; apps/pharmacy/src/features/order-fulfillment/handover/**; apps/pharmacy/src/features/order-fulfillment/api/complete-picking.api.ts |
| DTJ-313 | Схема БД и доменные сущности модуля delivery (scaffolding) | EP-13 | domain | L | — | apps/api/migrations/00xx_delivery_module_schema.sql; apps/api/src/db/schema/couriers.ts; apps/api/src/db/schema/delivery-assignments.ts; +14 файлов |
| DTJ-314 | DeliveryFacade и алгоритм подбора курьера (SuggestNearestCourierUseCase) | EP-13 | application | L | DTJ-313 | apps/api/src/modules/delivery/index.ts; apps/api/src/modules/delivery/application/delivery.facade.ts; apps/api/src/modules/delivery/application/use-cases/suggest-nearest-courier.use-case.ts; +2 файлов |
| DTJ-315 | Создание назначения и цепочка офферов курьеру (offer lifecycle) | EP-13 | application | L | DTJ-314 | apps/api/src/modules/delivery/application/use-cases/create-delivery-assignment.use-case.ts; apps/api/src/modules/delivery/application/use-cases/accept-delivery-offer.use-case.ts; apps/api/src/modules/delivery/application/use-cases/decline-delivery-offer.use-case.ts; +3 файлов |
| DTJ-316 | Пул назначений и ручное назначение/переназначение диспетчером | EP-13 | application | M | DTJ-315 | apps/api/src/modules/delivery/application/use-cases/claim-delivery-assignment.use-case.ts; apps/api/src/modules/delivery/application/use-cases/assign-manual.use-case.ts; apps/api/src/modules/delivery/application/use-cases/reassign-delivery.use-case.ts; +2 файлов |
| DTJ-317 | Детали назначения и статусные переходы курьера (depart → deliver) | EP-13 | application | L | DTJ-315 | apps/api/src/modules/delivery/application/use-cases/depart.use-case.ts; apps/api/src/modules/delivery/application/use-cases/depart-to-customer.use-case.ts; apps/api/src/modules/delivery/application/use-cases/record-cash.use-case.ts; +6 файлов |
| DTJ-318 | Нештатные сценарии доставки (report-issue, mark-failed, refuse-at-door, форс-отмена) | EP-13 | application | M | DTJ-317 | apps/api/src/modules/delivery/application/use-cases/report-delivery-issue.use-case.ts; apps/api/src/modules/delivery/application/use-cases/mark-delivery-failed.use-case.ts; apps/api/src/modules/delivery/application/use-cases/refuse-at-door.use-case.ts; +2 файлов |
| DTJ-319 | Геолокация курьера и живой ETA клиента | EP-13 | application | M | DTJ-317 | apps/api/src/modules/delivery/application/use-cases/record-courier-locations.use-case.ts; apps/api/src/modules/delivery/application/use-cases/calculate-courier-eta.use-case.ts; apps/api/src/modules/delivery/infrastructure/realtime/location-broadcast.publisher.ts; +1 файлов |
| DTJ-320 | Смены курьера и сверка наличных | EP-13 | application | M | DTJ-313 | apps/api/src/modules/delivery/application/use-cases/start-courier-shift.use-case.ts; apps/api/src/modules/delivery/application/use-cases/end-courier-shift.use-case.ts; apps/api/src/modules/delivery/presentation/courier-shifts.controller.ts |
| DTJ-321 | Заработок, выплаты и рейтинг курьера (read-эндпоинты) | EP-13 | application | S | DTJ-313 | apps/api/src/modules/delivery/application/use-cases/submit-courier-rating.use-case.ts; apps/api/src/modules/delivery/presentation/courier-earnings.controller.ts; apps/api/src/modules/delivery/presentation/courier-ratings.controller.ts |
| DTJ-322 | Тарификация и зоны доставки (DeliveryFacade.calculateDeliveryFee) | EP-13 | application | M | DTJ-314 | apps/api/src/modules/delivery/application/use-cases/calculate-delivery-fee.use-case.ts; apps/api/src/modules/delivery/application/use-cases/manage-delivery-zones.use-case.ts; apps/api/src/modules/delivery/application/use-cases/manage-delivery-pricing-rules.use-case.ts; +2 файлов |
| DTJ-323 | Realtime-события модуля delivery (WS) | EP-13 | presentation | S | DTJ-315, DTJ-316, DTJ-317, DTJ-318, DTJ-319 | apps/api/src/modules/delivery/infrastructure/realtime/delivery-events.publisher.ts |
| DTJ-324 | RBAC, политики и межтенантная изоляция модуля delivery — сквозные тесты | EP-13 | tests | M | DTJ-315, DTJ-316, DTJ-317, DTJ-318, DTJ-319, DTJ-320, DTJ-321, DTJ-322 | apps/api/test/integration/delivery/rbac-isolation.spec.ts; apps/api/test/integration/delivery/idempotency.spec.ts; apps/api/src/modules/delivery/application/policies/delivery-assignment-ownership.policy.ts; +1 файлов |
| DTJ-325 | apps/courier: scaffolding веб-приложения курьера | EP-13 | frontend | M | DTJ-324 | apps/courier/** |
| DTJ-326 | apps/courier: экран смены (старт/финиш, сводка наличных) | EP-13 | frontend | S | DTJ-320, DTJ-325 | apps/courier/src/features/shift/** |
| DTJ-327 | apps/courier: офферы и пул назначений | EP-13 | frontend | M | DTJ-315, DTJ-316, DTJ-323, DTJ-326 | apps/courier/src/features/offers/**; apps/courier/src/features/pool/** |
| DTJ-328 | apps/courier: экран активной доставки — карта, статусы, ориентиры | EP-13 | frontend | L | DTJ-317, DTJ-323, DTJ-327 | apps/courier/src/features/active-delivery/** |
| DTJ-329 | apps/courier: приём наличных и ввод OTP вручения | EP-13 | frontend | M | DTJ-317, DTJ-328 | apps/courier/src/features/cash-collection/**; apps/courier/src/features/otp-entry/** |
| DTJ-330 | apps/courier: сообщение о проблеме и отказ на пороге | EP-13 | frontend | S | DTJ-318, DTJ-328 | apps/courier/src/features/delivery-issue/** |
| DTJ-331 | apps/courier: заработок и история выплат | EP-13 | frontend | S | DTJ-321, DTJ-325 | apps/courier/src/features/earnings/** |
| DTJ-332 | apps/courier: геолокация и офлайн-очередь действий (веб) | EP-13 | frontend | L | DTJ-319, DTJ-328, DTJ-329 | apps/courier/src/shared/geolocation/**; apps/courier/src/shared/offline-queue/** |
| DTJ-350 | Скелет модуля admin (backend) и каркас разделов apps/admin для super_admin/pharmacy_admin | EP-15 | infrastructure | M | — | apps/api/src/modules/admin/admin.module.ts; apps/api/src/modules/admin/index.ts; apps/api/src/modules/admin/application/ports/onboarding-facade.port.ts; +7 файлов |
| DTJ-351 | Админ-панель — тенанты (список/деталь) и PATCH tenant-settings | EP-15 | application | S | DTJ-350 | apps/api/src/modules/admin/application/use-cases/list-tenants.use-case.ts; apps/api/src/modules/admin/application/use-cases/get-tenant.use-case.ts; apps/api/src/modules/admin/application/use-cases/update-tenant-settings.use-case.ts; +5 файлов |
| DTJ-352 | Фиче-флаги — таблица feature_flags и CRUD-экран (глобальные и per-tenant) | EP-15 | infrastructure | S | DTJ-350 | apps/api/src/db/schema/feature-flags.ts; apps/api/migrations/00XX_feature_flags.sql; apps/api/src/modules/admin/domain/feature-flag.entity.ts; +7 файлов |
| DTJ-353 | Кросс-тенантный обзор аптек для super_admin | EP-15 | application | S | DTJ-350 | apps/api/src/modules/admin/application/use-cases/list-pharmacy-accounts-any.use-case.ts; apps/api/src/modules/admin/presentation/pharmacy-accounts-admin.controller.ts; apps/admin/src/features/pharmacies-crud/api/use-pharmacy-accounts.ts; +2 файлов |
| DTJ-354 | Пользователи — поиск/деактивация/смена бытовой роли + grant-platform-role | EP-15 | application | M | DTJ-350, DTJ-374 | apps/api/src/db/schema/enums/audit-action-category.ts; apps/api/migrations/00XX_audit_action_category_add_role_grant.sql; apps/api/src/modules/admin/application/use-cases/list-users.use-case.ts; +7 файлов |
| DTJ-355 | Заказы (super_admin) — кросс-тенантный поиск, деталь с полной таймлайном | EP-15 | application | M | DTJ-350 | apps/api/src/modules/admin/application/use-cases/list-orders-any.use-case.ts; apps/api/src/modules/admin/application/use-cases/get-order-detail-admin.use-case.ts; apps/api/src/modules/admin/presentation/orders-admin.controller.ts; +4 файлов |
| DTJ-356 | Заказы — ручной payment-override и admin-force-cancel с обязательным аудитом | EP-15 | application | M | DTJ-355, DTJ-374 | apps/api/src/modules/admin/application/use-cases/admin-payment-override.use-case.ts; apps/api/src/modules/admin/application/use-cases/admin-force-cancel-order.use-case.ts; apps/api/src/modules/admin/presentation/orders-admin-actions.controller.ts; +4 файлов |
| DTJ-357 | Финансы — просмотр escrow-ledger, payout-schedule и алертов рассинхронизации | EP-15 | application | M | DTJ-350 | apps/api/src/modules/admin/application/use-cases/list-escrow-ledger.use-case.ts; apps/api/src/modules/admin/application/use-cases/list-payout-schedule.use-case.ts; apps/api/src/modules/admin/application/use-cases/list-reconciliation-alerts.use-case.ts; +6 файлов |
| DTJ-358 | Финансы — управление ставками комиссии (commission-rates) | EP-15 | application | S | DTJ-350 | apps/api/src/modules/admin/application/use-cases/list-commission-rates.use-case.ts; apps/api/src/modules/admin/application/use-cases/upsert-commission-rate.use-case.ts; apps/api/src/modules/admin/presentation/commission-rates.controller.ts; +2 файлов |
| DTJ-359 | Финансы — инвойсы cash_courier-комиссии, ручная отметка оплаты и джоба просрочки | EP-15 | application | L | DTJ-350, DTJ-374 | apps/api/src/modules/admin/application/use-cases/list-billing-invoices.use-case.ts; apps/api/src/modules/admin/application/use-cases/mark-invoice-paid.use-case.ts; apps/api/src/modules/admin/application/use-cases/lift-invoice-block.use-case.ts; +4 файлов |
| DTJ-360 | Настройки платформы — read-only экран process-level ENV-констант | EP-15 | application | S | DTJ-350 | apps/api/src/modules/admin/application/use-cases/get-platform-settings.use-case.ts; apps/api/src/modules/admin/presentation/platform-settings.controller.ts; apps/admin/src/features/platform-settings/ui/platform-settings-page.tsx; +1 файлов |
| DTJ-361 | Инфраструктура экспорта отчётов — синхронный CSV/XLSX и асинхронная джоба для длинных периодов | EP-15 | infrastructure | L | DTJ-350 | apps/api/src/modules/admin/application/ports/report-export.port.ts; apps/api/src/modules/admin/application/use-cases/request-report-export.use-case.ts; apps/api/src/modules/admin/application/use-cases/get-export-job-status.use-case.ts; +6 файлов |
| DTJ-362 | Кабинет pharmacy_admin — свои аптеки (обзор) и сводка остатков | EP-15 | application | S | DTJ-350, DTJ-353 | apps/api/src/modules/admin/application/use-cases/list-pharmacy-accounts-own.use-case.ts; apps/api/src/modules/admin/application/use-cases/get-inventory-summary.use-case.ts; apps/api/src/modules/admin/presentation/pharmacy-accounts-admin.controller.ts (общий с DTJ-353 — добавляется ветка scope=own и метод inventory-summary); +1 файлов |
| DTJ-363 | Кабинет pharmacy_admin — свои заказы (обзорный список сети) | EP-15 | application | S | DTJ-350, DTJ-355 | apps/api/src/modules/admin/application/use-cases/list-orders-own.use-case.ts; apps/api/src/modules/admin/presentation/orders-admin.controller.ts (общий с DTJ-355 — добавляется ветка scope=own); apps/admin/src/features/orders/ui/own-orders-page.tsx |
| DTJ-364 | Кабинет pharmacy_admin — сотрудники (staff-accounts): создание, список, деактивация | EP-15 | application | M | DTJ-350 | apps/api/src/modules/admin/application/use-cases/create-staff-account.use-case.ts; apps/api/src/modules/admin/application/use-cases/list-staff-accounts.use-case.ts; apps/api/src/modules/admin/application/use-cases/deactivate-staff-account.use-case.ts; +4 файлов |
| DTJ-365 | Кабинет pharmacy_admin — API-ключи 1С (создание, ротация, отзыв, mTLS) | EP-15 | application | L | DTJ-350 | apps/api/src/modules/admin/application/use-cases/create-pharmacy-api-key.use-case.ts; apps/api/src/modules/admin/application/use-cases/rotate-pharmacy-api-key.use-case.ts; apps/api/src/modules/admin/application/use-cases/revoke-pharmacy-api-key.use-case.ts; +7 файлов |
| DTJ-366 | Кабинет pharmacy_admin — отчёты (продажи, выплаты, история 1С-синхронизации, здоровье остатков) | EP-15 | application | M | DTJ-350, DTJ-361 | apps/api/src/modules/admin/application/use-cases/get-sales-report.use-case.ts; apps/api/src/modules/admin/application/use-cases/get-payouts-report.use-case.ts; apps/api/src/modules/admin/application/use-cases/get-inventory-sync-history.use-case.ts; +8 файлов |
| DTJ-367 | Кабинет pharmacy_admin — расписание работы и круговая зона доставки | EP-15 | application | S | DTJ-350 | apps/api/migrations/00XX_pharmacies_max_delivery_radius_km.sql; apps/api/src/db/schema/pharmacies.ts; apps/api/src/modules/admin/application/use-cases/update-pharmacy-schedule.use-case.ts; +4 файлов |
| DTJ-368 | Скелет модуля notifications и провайдеры TelegramNotifyProvider/InAppNotifyProvider | EP-16 | infrastructure | M | — | apps/api/src/modules/notifications/notifications.module.ts; apps/api/src/modules/notifications/index.ts; apps/api/src/modules/notifications/application/ports/notify-provider.port.ts; +3 файлов |
| DTJ-369 | Таблица notification_templates, сид на tj/ru/en и CI-тест полноты матрицы | EP-16 | infrastructure | M | DTJ-368 | apps/api/migrations/00XX_notification_templates.sql; apps/api/src/db/schema/notification-templates.ts; apps/api/src/modules/notifications/domain/notification-template.entity.ts; +4 файлов |
| DTJ-370 | DispatchNotificationUseCase — матрица событие×роль×канал, фолбэк, ретраи, троттлинг, дедуп | EP-16 | application | L | DTJ-368, DTJ-369 | apps/api/migrations/00XX_notifications_source_event_id.sql; apps/api/src/db/schema/notifications.ts; apps/api/src/modules/notifications/application/use-cases/dispatch-notification.use-case.ts; +4 файлов |
| DTJ-371 | notification_preferences — тихие часы и переключатели категорий с защитой критичных | EP-16 | application | M | DTJ-370 | apps/api/migrations/00XX_notification_preferences.sql; apps/api/src/db/schema/notification-preferences.ts; apps/api/src/modules/notifications/domain/notification-preference.entity.ts; +5 файлов |
| DTJ-372 | GET /api/v1/notifications — собственная лента уведомлений (in-app inbox) | EP-16 | application | S | DTJ-368 | apps/api/src/modules/notifications/application/use-cases/list-own-notifications.use-case.ts; apps/api/src/modules/notifications/presentation/notifications-feed.controller.ts; packages/contracts/src/notifications.ts |
| DTJ-373 | Админ-экран диагностики недоставленных уведомлений | EP-16 | application | S | DTJ-370 | apps/api/src/modules/notifications/application/use-cases/list-undelivered-notifications.use-case.ts; apps/api/src/modules/notifications/presentation/notifications-diagnostics.controller.ts; apps/admin/src/features/notifications/api/use-undelivered-notifications.ts; +1 файлов |
| DTJ-374 | audit_log — AuditLogPort, append-only репозиторий и REVOKE на уровне БД | EP-16 | infrastructure | M | — | apps/api/migrations/00XX_audit_log_revoke_update_delete.sql; apps/api/src/common/audit/audit-log.port.ts; apps/api/src/common/audit/audit-log.module.ts; +2 файлов |
| DTJ-375 | Общий список чувствительных полей и его интеграция с pino и audit_log | EP-16 | infrastructure | S | DTJ-374 | packages/contracts/src/sensitive-fields.ts; apps/api/src/common/logging/pino-redaction.config.ts; apps/api/src/common/audit/infrastructure/audit-log.repository.ts (общий с DTJ-374 — заменяет временный локальный список на общий) |
| DTJ-376 | GET /api/v1/audit-log и экран журнала аудита для super_admin | EP-16 | application | M | DTJ-374, DTJ-375 | apps/api/src/common/audit/application/use-cases/list-audit-log.use-case.ts; apps/api/src/common/audit/presentation/audit-log.controller.ts; apps/admin/src/features/audit-log/api/use-audit-log.ts; +2 файлов |
| DTJ-377 | AuditLogRetentionJob — квартальная батчевая очистка по сроку хранения | EP-16 | infrastructure | S | DTJ-374 | apps/worker/src/jobs/audit-log-retention/audit-log-retention.job.ts; apps/api/src/common/audit/config/audit-retention.config.ts |
| DTJ-378 | Скелет модуля analytics, AnalyticsFacade.recordEvent и таблица product_events | EP-17 | infrastructure | M | — | apps/api/migrations/00XX_product_events.sql; apps/api/src/db/schema/product-events.ts; apps/api/src/modules/analytics/analytics.module.ts; +5 файлов |
| DTJ-379 | POST /api/v1/analytics/events — приём клиентской UX-телеметрии (батч, fire-and-forget) | EP-17 | application | S | DTJ-378 | apps/api/src/modules/analytics/application/use-cases/record-product-events-batch.use-case.ts; apps/api/src/modules/analytics/presentation/analytics-events.controller.ts; packages/contracts/src/analytics.ts |
| DTJ-380 | Событие order_placed из CheckoutUseCase и расчёт реализованной экономии | EP-17 | application | M | DTJ-378 | apps/api/src/modules/analytics/application/services/realized-savings-calculator.ts; apps/api/src/modules/orders/application/use-cases/checkout.use-case.ts |
| DTJ-381 | GET /api/v1/analytics/funnel и экран воронки в apps/admin (по дизайн-референсу) | EP-17 | application | M | DTJ-379, DTJ-380 | apps/api/src/modules/analytics/application/use-cases/get-funnel.use-case.ts; apps/api/src/modules/analytics/presentation/analytics-dashboard.controller.ts; apps/admin/src/features/analytics/api/use-funnel.ts; +1 файлов |
| DTJ-382 | GET /api/v1/analytics/platform-metrics и дашборд платформенных метрик | EP-17 | application | M | DTJ-378 | apps/api/src/modules/analytics/application/use-cases/get-platform-metrics.use-case.ts; apps/api/src/modules/analytics/presentation/analytics-dashboard.controller.ts (общий с DTJ-381 — добавляется второй метод); apps/admin/src/features/analytics/ui/platform-metrics-page.tsx |
| DTJ-383 | Отчёт «Топ аналогов по показанной экономии» — backend и таблица в apps/admin | EP-17 | application | S | DTJ-379 | apps/api/src/modules/analytics/application/use-cases/get-top-analogs-report.use-case.ts; apps/api/src/modules/analytics/presentation/analytics-reports.controller.ts; apps/admin/src/features/analytics/ui/top-analogs-page.tsx |
| DTJ-384 | GET /api/v1/analytics/onboarding-funnel и экран воронки онбординга аптек | EP-17 | application | S | DTJ-378 | apps/api/src/modules/analytics/application/use-cases/get-onboarding-funnel.use-case.ts; apps/api/src/modules/analytics/presentation/analytics-reports.controller.ts (общий с DTJ-383 — добавляется третий метод); apps/admin/src/features/analytics/ui/onboarding-funnel-page.tsx |
| DTJ-385 | Экономия в analog_shown/added_to_cart считает сервер | EP-17 | application | M | DTJ-379, DTJ-380 | apps/api/src/modules/analytics/application/ports/analog-savings.port.ts; apps/api/src/modules/analytics/infrastructure/adapters/catalog-analog-savings.adapter.ts; +3 файлов |
| DTJ-400 | Инициализировать пакеты packages/ui и packages/i18n (скелет, сборка, Storybook) | EP-18 | frontend | S | — | packages/ui/package.json; packages/ui/tsconfig.json; packages/ui/vite.config.ts; +6 файлов |
| DTJ-401 | Реализовать дизайн-токены (цвет/типографика/отступы/радиусы/тени) и валидатор White-Label allowlist | EP-18 | frontend | M | DTJ-400 | packages/ui/src/tokens/colors.css; packages/ui/src/tokens/typography.css; packages/ui/src/tokens/spacing.css; +5 файлов |
| DTJ-402 | Реализовать ядро packages/i18n — словари tj/ru/en, useT(), резолвинг локали, форматирование | EP-18 | frontend | L | DTJ-400 | packages/i18n/src/locales/tj.json; packages/i18n/src/locales/ru.json; packages/i18n/src/locales/en.json; +10 файлов |
| DTJ-403 | Построить инфраструктуру автопроверки доступности (axe, hit-area, reduced-motion, focus-trap) | EP-18 | frontend | M | DTJ-400 | packages/ui/src/a11y/use-reduced-motion.ts; packages/ui/src/a11y/use-focus-trap.ts; packages/ui/src/a11y/assert-hit-area.ts; +3 файлов |
| DTJ-404 | Реализовать базовые примитивы packages/ui — Button, IconButton, Input, Textarea, Skeleton, Badge, Chip, Card | EP-18 | frontend | L | DTJ-401, DTJ-402, DTJ-403 | packages/ui/src/components/button/button.tsx; packages/ui/src/components/button/button.spec.tsx; packages/ui/src/components/button/button.stories.tsx; +11 файлов |
| DTJ-405 | Реализовать формы ввода packages/ui — PhoneInput, OtpInput, Select, RadioGroup, Checkbox, Switch | EP-18 | frontend | M | DTJ-404 | packages/ui/src/components/phone-input/phone-input.tsx; packages/ui/src/components/phone-input/phone-input.spec.tsx; packages/ui/src/components/otp-input/otp-input.tsx; +7 файлов |
| DTJ-406 | Реализовать обратную связь и оверлеи packages/ui — Toast, Modal/BottomSheet, EmptyState, ErrorState, OfflineBanner, ProgressBar | EP-18 | frontend | L | DTJ-404 | packages/ui/src/components/toast/toast.tsx; packages/ui/src/components/toast/use-toast.ts; packages/ui/src/components/modal/modal.tsx; +8 файлов |
| DTJ-407 | Реализовать доменные витринные компоненты packages/ui — PriceTag, SavingsBadge, AnalogBanner, MedicineCard, PharmacyOfferRow, CountdownTimer, OrderTimeline | EP-18 | frontend | L | DTJ-404, DTJ-405 | packages/ui/src/components/price-tag/price-tag.tsx; packages/ui/src/components/price-tag/price-tag.spec.tsx; packages/ui/src/components/savings-badge/savings-badge.tsx; +7 файлов |
| DTJ-408 | Реализовать навигацию и данные packages/ui — Tabs, Stepper, CursorTable/CursorList, SearchBar, LanguageSwitcher, BrandLogo | EP-18 | frontend | M | DTJ-404 | packages/ui/src/components/tabs/tabs.tsx; packages/ui/src/components/stepper/stepper.tsx; packages/ui/src/components/cursor-list/cursor-table.tsx; +7 файлов |
| DTJ-409 | Реализовать обёртку MapView (MapLibre GL JS) для packages/ui | EP-18 | frontend | M | DTJ-401, DTJ-404 | packages/ui/src/components/map-view/map-view.tsx; packages/ui/src/components/map-view/map-view.spec.tsx; packages/ui/src/components/map-view/use-map-markers.ts; +1 файлов |
| DTJ-410 | Реализовать FileDropzone и AudioAlertPlayer для packages/ui | EP-18 | frontend | S | DTJ-401, DTJ-404 | packages/ui/src/components/file-dropzone/file-dropzone.tsx; packages/ui/src/components/file-dropzone/file-dropzone.spec.tsx; packages/ui/src/components/audio-alert-player/audio-alert-player.tsx; +2 файлов |
| DTJ-411 | Реализовать слой темизации и хуков Telegram Mini App в packages/ui | EP-18 | frontend | M | DTJ-401, DTJ-404, DTJ-406 | packages/ui/src/twa/use-telegram-theme.ts; packages/ui/src/twa/use-telegram-theme.spec.ts; packages/ui/src/twa/use-main-button.ts; +4 файлов |
| DTJ-412 | Собрать Docker Compose стек dev/staging/prod (Postgres/Redis/MinIO/Nginx/apps) + multi-stage Dockerfile'ы | EP-19 | infra | L | — | infra/docker/docker-compose.yml; infra/docker/docker-compose.prod.yml; infra/docker/Dockerfile.api; +4 файлов |
| DTJ-413 | Собрать эфемерный docker-compose.test.yml для integration/e2e прогонов | EP-19 | infra | XS | DTJ-412 | infra/docker/docker-compose.test.yml |
| DTJ-414 | Настроить GitHub Actions CI-пайплайн (typecheck/lint/arch, unit, integration, security, build, e2e, release) | EP-19 | infra | L | DTJ-412, DTJ-413 | .github/workflows/ci.yml |
| DTJ-415 | Построить tests/arch/ — фикстуры-нарушители и тест, что arch:check/lint их отвергают | EP-19 | tests | M | — | tests/arch/fixtures/domain-imports-drizzle/; tests/arch/fixtures/domain-uses-date-now/; tests/arch/fixtures/magic-number/; +5 файлов |
| DTJ-416 | Собрать packages/testing-kit — детерминированные тест-дублёры (Clock/Id/Otp) и builder-фабрики | EP-19 | tests | M | — | packages/testing-kit/package.json; packages/testing-kit/tsconfig.json; packages/testing-kit/src/fixed-clock.adapter.ts; +6 файлов |
| DTJ-417 | Построить каркас E2E-инфраструктуры Playwright (конфиг, помощники OTP/Telegram, axe, фикстуры) | EP-19 | tests | L | DTJ-412, DTJ-413, DTJ-416 | tests/e2e/playwright.config.ts; tests/e2e/helpers/get-otp-from-mock-sms.ts; tests/e2e/helpers/mock-telegram-bot-api-server.ts; +6 файлов |
| DTJ-418 | Реализовать E2E: CUJ-1 (поиск и аналоги) и CUJ-6' (Excel/1С-синхронизация остатков) | EP-19 | tests | M | DTJ-417 | tests/e2e/cuj-1-search-and-analogs.e2e-spec.ts; tests/e2e/cuj-6-inventory-sync.e2e-spec.ts; tests/fixtures/inventory/valid-import-template.xlsx; +1 файлов |
| DTJ-419 | Реализовать E2E: CUJ-2' (заказ с оплатой наличными) и CUJ-7' (White-Label/изоляция тенантов) | EP-19 | tests | M | DTJ-417 | tests/e2e/cuj-2-cash-checkout.e2e-spec.ts; tests/e2e/cuj-7-tenant-isolation.e2e-spec.ts |
| DTJ-420 | Реализовать E2E: CUJ-3' (сборка фармацевтом) и CUJ-4' (доставка курьером) | EP-19 | tests | L | DTJ-417, DTJ-416 | tests/e2e/cuj-3-pharmacy-assembly.e2e-spec.ts; tests/e2e/cuj-4-courier-delivery.e2e-spec.ts |
| DTJ-421 | Реализовать E2E: CUJ-9 (модерация и онбординг аптеки) и CUJ-10 (поток авторизации) | EP-19 | tests | M | DTJ-417 | tests/e2e/cuj-9-admin-onboarding.e2e-spec.ts; tests/e2e/cuj-10-auth-flow.e2e-spec.ts; tests/fixtures/onboarding/license-valid.pdf |
| DTJ-422 | Реализовать E2E: CUJ-11 (Telegram-уведомления вне TWA) и CUJ-12 (i18n-инвариант) | EP-19 | tests | M | DTJ-417, DTJ-402 | tests/e2e/cuj-11-telegram-notifications.e2e-spec.ts; tests/e2e/cuj-12-i18n.e2e-spec.ts; tests/e2e/helpers/dom-text-snapshot.ts |
| DTJ-423 | Реализовать E2E: CUJ-13 (воронка аналитики экономии) и инвариант смены бренда (D-01) | EP-19 | tests | M | DTJ-417, DTJ-419, DTJ-422 | tests/e2e/cuj-13-analytics-funnel.e2e-spec.ts; tests/e2e/brand-invariant.e2e-spec.ts |
| DTJ-424 | Построить нагрузочные тесты k6 (поиск, 1С-ingestion, checkout) и еженедельный CI-job | EP-19 | tests | M | DTJ-412 | tests/load/catalog-search.k6.js; tests/load/inventory-sync.k6.js; tests/load/checkout.k6.js; +1 файлов |
| DTJ-425 | Построить security test suite (SQLi/XSS/SSRF/CSRF/DoS/rate-limit/file-upload) и pnpm audit гейт | EP-19 | tests | L | DTJ-414 | tests/security/sql-injection.spec.ts; tests/security/xss.spec.ts; tests/security/ssrf.spec.ts; +7 файлов |
| DTJ-426 | Реализовать CI-гейт env:check (.env.example vs Zod-схема конфигурации) | EP-19 | infra | S | DTJ-414 | .env.example; scripts/env-check.ts; .github/workflows/ci.yml |
| DTJ-427 | Реализовать CI-гейт бюджета JS первого экрана (pnpm size-check, ≤250KB gzip) | EP-19 | infra | S | DTJ-414 | scripts/size-check.ts; .github/workflows/ci.yml |
| DTJ-428 | Подготовить автоматизацию релиза (rolling-деплой, откат) и чек-лист готовности к продакшену | EP-19 | infra | M | DTJ-412 | scripts/deploy/rolling-deploy.sh; scripts/deploy/rollback.sh; scripts/deploy/backup-restore-drill.sh; +1 файлов |
| DTJ-432 | Глобальный rate-limit (@fastify/rate-limit + Redis, SRS-API-012) | EP-19 | infrastructure | M | — | apps/api/src/main.ts; apps/api/src/common/http/rate-limit/rate-limit.config.ts; apps/api/src/common/http/rate-limit/rate-limit.decorator.ts; +2 файлов |

¹ `0008_i18n_overrides_review_status.sql` (DTJ-103) ещё не реализован, но это имя уже занято
двумя другими миграциями (`0008_onboarding_foundation.sql`, `0008_user_telegram_identities.sql`) —
см. `tickets/ep03-catalog-analogs/DTJ-103.md` для подробностей, номер потребует пересчёта на
момент реализации.

² `0015b_inventory_sync_enum_extension.sql` (DTJ-142) удалена: делала `ALTER TYPE
inventory_sync_row_error_code`, но `CREATE TYPE` для этого типа не существует ни в одной
миграции, таблица `inventory_sync_errors` нигде не создаётся, drizzle-адаптера нет —
`appendErrors` реализован только in-memory. См. `tickets/ep04-inventory-ingestion/DTJ-142.md`.

---

## Граф зависимостей

**Проверка на циклы:** построен полный граф по 271 тикету и всем 19 cross-epic
рёбрам (см. список ниже) плюс все внутриэпиковые рёбра — итого весь буквальный
граф `depends_on`, какой он есть в файлах. Алгоритм: DFS с трёхцветной раскраской
(белый/серый/чёрный), поиск обратного ребра в серую вершину. **Циклов не найдено.**
Граф является корректным DAG.

**Висячие зависимости:** для каждого `depends_on` каждого из 271 тикета проверено
существование ID в общем реестре. **Не найдено ни одного висячего `depends_on`** —
каждая ссылка указывает на реально существующий тикет.

### Явные cross-epic рёбра (19 из ~600 суммарных рёбер `depends_on`)

Все остальные рёбра `depends_on` — внутриэпиковые. Эти 19 — единственные, где автор
тикетов явно сослался на конкретный тикет другого эпика (а не понадеялся на
эпик-уровневую волну из `00-EPICS.md`):

| Тикет | → зависит от | Эпик тикета | Эпик зависимости |
|---|---|---|---|
| DTJ-095 | DTJ-101 | EP-04 | EP-07 |
| DTJ-099 | DTJ-090 | EP-07 | EP-04 |
| DTJ-099 | DTJ-093 | EP-07 | EP-04 |
| DTJ-100 | DTJ-091 | EP-07 | EP-04 |
| DTJ-100 | DTJ-092 | EP-07 | EP-04 |
| DTJ-101 | DTJ-096 | EP-07 | EP-04 |
| DTJ-103 | DTJ-091 | EP-07 | EP-04 |
| DTJ-196 | DTJ-184 | EP-08 | EP-06 |
| DTJ-241 | DTJ-227 | EP-10 | EP-09 |
| DTJ-242 | DTJ-222 | EP-10 | EP-09 |
| DTJ-253 | DTJ-222 | EP-10 | EP-09 |
| DTJ-253 | DTJ-228 | EP-10 | EP-09 |
| DTJ-254 | DTJ-222 | EP-10 | EP-09 |
| DTJ-255 | DTJ-222 | EP-10 | EP-09 |
| DTJ-278 | DTJ-270 | EP-14 | EP-11 |
| DTJ-354 | DTJ-374 | EP-15 | EP-16 |
| DTJ-356 | DTJ-374 | EP-15 | EP-16 |
| DTJ-359 | DTJ-374 | EP-15 | EP-16 |
| DTJ-422 | DTJ-402 | EP-19 | EP-18 |

Все 19 согласуются с направлением зависимостей эпиков в `00-EPICS.md` (например
EP-07 Analog Engine действительно зависит от EP-04 Каталог; EP-10 Оплата — от EP-09
Заказы; EP-15 Админ-панель — от EP-16 audit_log/notifications в части конкретных
read-моделей). Обратных (нарушающих порядок эпиков) рёбер не найдено.

### Уровни выполнения (эпик-уровневые волны, источник — `00-EPICS.md`)

| Волна | Эпики | Готов к старту, когда закрыто |
|---|---|---|
| 1 | EP-01 | — (первая волна) |
| 2 | EP-02, EP-04 | EP-01 |
| 3 | EP-03 | EP-02 |
| 4 | EP-05 | EP-03 (и EP-04, у которого запас времени) |
| 5 | EP-06 | EP-04, EP-05 |
| 6 | EP-07, EP-08, EP-09 | EP-06 (и EP-04 для EP-07/EP-09) |
| 7 | EP-10 | EP-09 |
| 8 | EP-11, EP-12 | EP-10 |
| 9 | EP-13 | EP-12 |
| 10 | EP-14, EP-15, EP-16 | EP-10, EP-13 (и EP-03/EP-09/EP-11/EP-12 частично) |
| 11 | EP-17 | EP-06, EP-07, EP-09, EP-15 |
| 12 | EP-19 (финальное закрытие) | все предыдущие волны + EP-18 |

EP-18 (Слой UX) и часть тикетов EP-19 (docker-compose/CI-скелет, tests/arch,
testing-kit) — сквозные, стартуют в волне 1 и тянутся инкрементально до волны 11-12
(детали — в разделе «План запуска разработчиков»).

---

## Критический путь

### Наивный расчёт по буквальному графу тикетов (для справки, это не итоговый ответ)

Если посчитать самую длинную по сумме условных единиц (`XS=1,S=2,M=3,L=5`) цепочку
**исключительно** по `depends_on` тикетов (без поправки на эпик-уровневые волны),
алгоритм находит:

```
DTJ-313 → DTJ-314 → DTJ-315 → DTJ-317 → DTJ-318 → DTJ-324 → DTJ-325 →
DTJ-326 → DTJ-327 → DTJ-328 → DTJ-329 → DTJ-332
```

12 тикетов, вес 47 — это **только внутренний путь EP-13** (Курьерский модуль), т.к.
`DTJ-313` формально имеет `depends_on: []` (см. методологическую врезку в начале
документа). Этот результат **вводит в заблуждение**: EP-13 — волна 9, а не волна 1,
и стартовать эту цепочку раньше готовности EP-12 нельзя. Приведён здесь как
иллюстрация того, почему наивный расчёт по одному графу тикетов непригоден для
планирования релиза — см. следующий подраздел.

### Скорректированный (реальный) критический путь

Берётся эпик-уровневая цепочка из `00-EPICS.md` (`EP-01 → EP-02 → EP-03 → EP-05 →
EP-06 → EP-09 → EP-10 → EP-12 → EP-13 → EP-19`, EP-04 исключён как имеющий запас
времени — обоснование см. в `00-EPICS.md`), и для каждого эпика этой цепочки
посчитана его собственная самая длинная внутриэпиковая цепочка тикетов по весу.
Итоговый критический путь — это последовательное прохождение всех 10 цепочек:

| Эпик | Вес (усл. ед.) | Тикетов в цепочке | Цепочка |
|---|---|---|---|
| EP-01 — Фундамент | 35 | 10 | DTJ-001 → DTJ-012 → DTJ-013 → DTJ-014 → DTJ-015 → DTJ-022 → DTJ-023 → DTJ-024 → DTJ-025 → DTJ-029 |
| EP-02 — Мультитенантность (tenant-guard) | 22 | 8 | DTJ-050 → DTJ-051 → DTJ-052 → DTJ-053 → DTJ-054 → DTJ-055 → DTJ-059 → DTJ-060 |
| EP-03 — Онбординг сети/аптеки | 27 | 8 | DTJ-063 → DTJ-064 → DTJ-065 → DTJ-066 → DTJ-068 → DTJ-070 → DTJ-071 → DTJ-073 |
| EP-05 — Приём остатков (3 канала) | 27 | 7 | DTJ-140 → DTJ-141 → DTJ-146 → DTJ-147 → DTJ-148 → DTJ-154 → DTJ-170 |
| EP-06 — Умный поиск + ранжирование + автодополнение | 23 | 7 | DTJ-180 → DTJ-182 → DTJ-185 → DTJ-188 → DTJ-190 → DTJ-192 → DTJ-193 |
| EP-09 — Корзина + Checkout | 28 | 8 | DTJ-220 → DTJ-221 → DTJ-222 → DTJ-227 → DTJ-228 → DTJ-231 → DTJ-233 → DTJ-235 |
| EP-10 — Оплата наличными + Escrow-ledger | 22 | 7 | DTJ-236 → DTJ-237 → DTJ-238 → DTJ-242 → DTJ-244 → DTJ-251 → DTJ-252 |
| EP-12 — Терминал фармацевта (API + веб-кабинет сборки) | 26 | 8 | DTJ-300 → DTJ-303 → DTJ-304 → DTJ-305 → DTJ-308 → DTJ-310 → DTJ-311 → DTJ-312 |
| EP-13 — Курьерский веб-модуль | 47 | 12 | DTJ-313 → DTJ-314 → DTJ-315 → DTJ-317 → DTJ-318 → DTJ-324 → DTJ-325 → DTJ-326 → DTJ-327 → DTJ-328 → DTJ-329 → DTJ-332 |
| EP-19 — CI/DevOps/тестовая пирамида | 17 | 5 | DTJ-412 → DTJ-413 → DTJ-417 → DTJ-419 → DTJ-423 |
| **Итого** | **274** | **80** | — |

**Реальный критический путь R1: 80 тикетов, 274 условных единиц**,
проходящих последовательно через 10 из 19 эпиков. Это в точности CUJ-цепочка
«поиск → аналог/цена видны → корзина → confirmed/paid_escrow → сборка аптекой →
вручение курьером → зелёный E2E», как и указано в `00-EPICS.md`.

**Не на критическом пути** (могут отставать на 1-2 волны без сдвига даты сквозного
пути, но обязаны быть готовы к финальной приёмке R1): EP-04 (запас времени внутри
волны 2), EP-07, EP-08 (Analog Engine, карта — волна 6, параллельно EP-09), EP-11
(возвраты), EP-14..EP-17 (споры/поддержка, админка, notification, аналитика), EP-18
(UX-слой, сквозной).

**Самый длинный одиночный эпик на критическом пути — EP-13** (Курьерский
веб-модуль): 12 тикетов, вес 47 — почти в 1.7 раза больше среднего эпика
критического пути (~27). При нехватке времени в релизе EP-13 — первый кандидат на
усиление командой (внутри него, начиная с под-волны 2, уже есть параллельные ветки —
см. «План запуска разработчиков», волна 9).

---

## План запуска разработчиков

Волна = группа эпиков, готовых к старту, потому что все их формальные зависимости (по
00-EPICS.md) уже закрыты предыдущими волнами. Внутри волны разные эпики закреплены за
разными командами и разрабатываются параллельно. Внутри одного эпика тикеты сгруппированы
в под-волны (Sub-N) по фактическому графу depends_on тикетов внутри этого же эпика (см.
методологию в разделе Граф зависимостей); тикеты внутри одной под-волны одного эпика не
зависят друг от друга по коду и в норме могут достаться разным разработчикам той же
команды одновременно, если между ними нет конфликта по files_owned (см. раздел
Конфликты владения файлами). Пары, где конфликт найден, помечены ниже значком WARN —
такая пара должна достаться одному разработчику или потребует явной внутренней очерёдности.

### Волна 1
Сквозные потоки (см. Обязательные сквозные тикеты в 00-EPICS.md): EP-18/DTJ-400
(бутстрап packages/ui+packages/i18n) и EP-19/DTJ-412, DTJ-415, DTJ-416
(docker-compose/CI-скелет, tests/arch, testing-kit) стартуют одновременно с EP-01
отдельными малыми составами.

**EP-01 — Фундамент** — команда/агент EP-01
- Под-волна 1: `DTJ-001` (L) Scaffolding apps/api — NestJS+Fastify каркас, health/ready, логирование, безопасность транспорта; `DTJ-002` (M) Scaffolding apps/worker — NestJS worker-процесс, BullMQ, health-порт, каркас OutboxRelayWorker; `DTJ-003` (M) Scaffolding apps/web — Vite+React shell, роутер, API-клиент, точки подключения i18n/ui; `DTJ-004` (S) packages/i18n — минимальный скелет словарей tj/ru/en и хук useT(); `DTJ-005` (L) packages/contracts — скелет: полный каталог ErrorCode, permission-строки RBAC, cursor-пагинация
- Под-волна 2: `DTJ-006` (M) shared-kernel: базовый Result-тип, порты Clock/IdGenerator и их адаптеры; `DTJ-012` (M) DB-инструментарий: конфигурация drizzle-kit, скрипты миграций, 0001_extensions.sql WARN; `DTJ-018` (L) API-конвенции: единый конверт ответа, DomainExceptionFilter/TransportExceptionFilter, cursor-хелперы; `DTJ-020` (M) Rate limiting: @fastify/rate-limit + Redis store, глобальные лимиты и декоратор @RateLimit; `DTJ-021` (M) OpenAPI: генерация из Zod (zod-to-openapi), Swagger UI за ENV-флагом, docs/api/openapi.json WARN
- Под-волна 3: `DTJ-007` (S) shared-kernel: Value Object Money (целые дирамы, арифметика, allocate); `DTJ-008` (S) shared-kernel: Value Objects PhoneNumber, TenantId, TenantSlug; `DTJ-009` (M) shared-kernel: Value Objects GeoPoint, Barcode, Dosage, DosageForm; `DTJ-010` (M) shared-kernel: Value Object OtpCode + OtpGeneratorPort + CryptoOtpGenerator адаптер; `DTJ-011` (M) shared-kernel: Value Objects OrderNumber (+ Redis-порт генерации) и ExpiryDate; `DTJ-013` (S) enums.schema.ts — bootstrap user_role и otp_purpose + миграция
- Под-волна 4: `DTJ-014` (M) Схема БД: users, user_addresses + миграция (FK на tenants/pharmacies отложены); `DTJ-016` (M) Схема БД: outbox, processed_events + подключение реального адаптера к OutboxRelayWorker
- Под-волна 5: `DTJ-015` (M) Схема БД: auth_sessions (ротация refresh) и otp_codes + миграция; `DTJ-017` (S) Схема БД: idempotency_keys + миграция (заполняет пробел в 11-database-schema.md)
- Под-волна 6: `DTJ-019` (M) Idempotency-Key: перехватчик, сравнение по sha256(body), обработка гонки, TTL-очистка; `DTJ-022` (L) modules/auth: каркас модуля, JWT RS256 (подпись/верификация), AuthGuard, RolesGuard/@Roles
- Под-волна 7: `DTJ-023` (M) RequestOtpUseCase + MockSmsProvider + POST /api/v1/auth/otp/request; `DTJ-027` (L) Telegram TWA auth: валидация initData, user_telegram_identities, POST /auth/telegram
- Под-волна 8: `DTJ-024` (L) VerifyOtpUseCase + POST /api/v1/auth/otp/verify (find-or-create, выдача JWT/refresh)
- Под-волна 9: `DTJ-025` (M) RefreshUseCase: ротация refresh-токена + обнаружение переиспользования + POST /auth/refresh; `DTJ-026` (M) Logout, logout-all, список и отзыв устройств (GET/DELETE /auth/sessions); `DTJ-028` (L) apps/web: экран /login (телефон → OTP), интеграция с authStore и http-client; `DTJ-030` (M) CreateStaffAccountUseCase + POST /api/v1/staff-accounts (заведение pharmacist/courier/support_agent)
- Под-волна 10: `DTJ-029` (M) Тест-сьют безопасности Auth: брутфорс, гонки, reuse detection, изоляция телефонов по тенанту

**EP-18 — Слой UX** (сквозной старт) — команда UX-платформа
- Под-волна 1: `DTJ-400` (S) Инициализировать пакеты packages/ui и packages/i18n (скелет, сборка, Storybook)

**EP-19 — CI/DevOps/тестовая пирамида** (сквозной старт) — команда DevOps
- Под-волна 1: `DTJ-412` (L) Собрать Docker Compose стек dev/staging/prod (Postgres/Redis/MinIO/Nginx/apps) + multi-stage Dockerfile'ы
- Под-волна 1: `DTJ-415` (M) Построить tests/arch/ — фикстуры-нарушители и тест, что arch:check/lint их отвергают
- Под-волна 1: `DTJ-416` (M) Собрать packages/testing-kit — детерминированные тест-дублёры (Clock/Id/Otp) и builder-фабрики

### Волна 2

**EP-02 — Мультитенантность (tenant-guard)** — команда/агент EP-02
- Под-волна 1: `DTJ-050` (M) Создать домен Tenant/TenantSettings, VO и скелет модуля tenancy
- Под-волна 2: `DTJ-051` (S) Создать схему БД tenants/tenant_settings и миграцию с seed нейтрального тенанта; `DTJ-056` (M) Создать TenantScopedRepository и переиспользуемый contract-test на утечку тенанта; `DTJ-058` (S) Реализовать SecretsVaultPort + EnvSecretsVaultAdapter (мерчант-креды и Telegram-токен)
- Под-волна 3: `DTJ-052` (S) Реализовать TenantRepository и TenantSettingsRepository (Drizzle); `DTJ-062` (S) Реализовать TelegramWebhookRouter — резолвинг тенанта по пути и проверка secret_token
- Под-волна 4: `DTJ-053` (S) Реализовать TenantCacheAdapter (Redis, TTL 60с) с деградацией к БД
- Под-волна 5: `DTJ-054` (M) Реализовать TenantResolutionMiddleware и TenantContext (AsyncLocalStorage)
- Под-волна 6: `DTJ-055` (M) Реализовать TenantResolutionGuard (400/403/404, super_admin override + аудит)
- Под-волна 7: `DTJ-057` (M) Реализовать ProvisionTenantUseCase и POST /api/v1/admin/tenants WARN; `DTJ-059` (L) Реализовать движок брендинга — BrandPaletteSchema, PUT/GET /tenant(s)/branding WARN; `DTJ-061` (M) Реализовать AttachCustomDomainUseCase и фоновую DNS-верификацию
- Под-волна 8: `DTJ-060` (S) Применить брендинг на фронте без пересборки (bootstrap-branding.ts) + правило запрета хардкода

**EP-04 — Модель каталога** — команда/агент EP-04
- Под-волна 1: `DTJ-090` (S) Скаффолдинг модуля catalog + пакет packages/domain-kernel (Dosage/DosageForm/Barcode VO)
- Под-волна 2: `DTJ-091` (M) DDL и Drizzle-схема для categories/substances/medicines/medicine_substances
- Под-волна 3: `DTJ-092` (M) CatalogRepository — порт и Drizzle-адаптер для medicines/substances/categories
- Под-волна 4: `DTJ-093` (M) Domain-сущность Medicine + MedicineSubstance, инварианты и модерационный gate control_category; `DTJ-094` (S) CategoryTreeService + GetCategoryTreeUseCase + GET /api/v1/categories
- Под-волна 5: `DTJ-095` (M) GetMedicineDetailUseCase + GET /api/v1/medicines/:id; `DTJ-096` (M) CatalogFacade — getMedicineSnapshot/getSubstances/isVisible + публикация доменных событий; `DTJ-098` (L) Seed-данные каталога — ≥300 курированных позиций с корректными связями МНН/веществ
- Под-волна 6: `DTJ-097` (L) resolveMedicineByComposite — движок сопоставления по штрихкоду и trigram-fuzzy (D-06)

**EP-18 — Слой UX** (продолжение) — команда UX-платформа
- Под-волна 2: `DTJ-401` (M) Реализовать дизайн-токены (цвет/типографика/отступы/радиусы/тени) и валидатор White-Label allowlist; `DTJ-402` (L) Реализовать ядро packages/i18n — словари tj/ru/en, useT(), резолвинг локали, форматирование; `DTJ-403` (M) Построить инфраструктуру автопроверки доступности (axe, hit-area, reduced-motion, focus-trap)

**EP-19 — CI/DevOps/тестовая пирамида** (продолжение) — команда DevOps
- Под-волна 2: `DTJ-413` (XS) Собрать эфемерный docker-compose.test.yml для integration/e2e прогонов; `DTJ-428` (M) Подготовить автоматизацию релиза (rolling-деплой, откат) и чек-лист готовности к продакшену
- Под-волна 3: `DTJ-414` (L) Настроить GitHub Actions CI-пайплайн (typecheck/lint/arch, unit, integration, security, build, e2e, release); `DTJ-417` (L) Построить каркас E2E-инфраструктуры Playwright (конфиг, помощники OTP/Telegram, axe, фикстуры)
- E2E DTJ-421 (CUJ-9 онбординг + CUJ-10 auth) по доменным данным готов уже здесь
  (EP-01 волна 1 + EP-03 волна 3), но по внутреннему графу EP-19 идёт вслед за
  DTJ-417 — можно вынести раньше при наличии свободных рук в команде DevOps.

### Волна 3

**EP-03 — Онбординг сети/аптеки** — команда/агент EP-03
- Под-волна 1: `DTJ-063` (L) Создать домен PharmacyChain/PharmacyAccount, схему pharmacy_verification/onboarding_review_log
- Под-волна 2: `DTJ-064` (M) Реализовать SubmitChainApplicationUseCase, POST /pharmacy-chains и OTP-верификацию контакта; `DTJ-067` (S) Реализовать очередь верификации — GET pending_review для сетей и аптек
- Под-волна 3: `DTJ-065` (M) Реализовать SubmitPharmacyApplicationUseCase, POST /pharmacy-accounts и загрузку документов
- Под-волна 4: `DTJ-066` (S) Реализовать переход draft→pending_review (submit) для заявок сети и аптеки; `DTJ-076` (M) Реализовать публичную форму заявки аптеки/сети /pharmacy-application (apps/web)
- Под-волна 5: `DTJ-068` (L) Реализовать решения оператора — approve/request-changes/reject/terminate
- Под-волна 6: `DTJ-069` (S) Реализовать повторную проверку при смене адреса активной аптеки; `DTJ-070` (M) Реализовать OnboardingFacade — публичные запросы статуса для других модулей; `DTJ-075` (L) Scaffolding apps/admin — очередь верификации и карточка заявки (первый экран admin)
- Под-волна 7: `DTJ-071` (M) Реализовать SuspendPharmacyUseCase и принудительную отмену незавершённых заказов
- Под-волна 8: `DTJ-072` (S) Реализовать RevokeVerificationUseCase (отзыв верификации, каскадная приостановка); `DTJ-073` (M) Реализовать LicenseExpiryCheckJob и список истекающих лицензий; `DTJ-074` (S) Реализовать RequestReactivationUseCase (suspended → pending_review)

**EP-18 — Слой UX** (продолжение) — команда UX-платформа
- Под-волна 3: `DTJ-404` (L) Реализовать базовые примитивы packages/ui — Button, IconButton, Input, Textarea, Skeleton, Badge, Chip, Card

### Волна 4

**EP-05 — Приём остатков (3 канала)** — команда/агент EP-05
- Под-волна 1: `DTJ-140` (L) Создать scaffolding модуля inventory (4 слоя) и барабанный файл контрактов
- Под-волна 2: `DTJ-141` (M) Drizzle-схема и baseline-миграция для основных таблиц inventory; `DTJ-143` (M) Domain-сущность PharmacyInventory (агрегат остатка, FEFO, инварианты); `DTJ-144` (M) Domain-агрегат InventorySyncBatch + явная state machine статусов; `DTJ-145` (S) VO InventoryBatchUpsertRow + каталог доменных ошибок inventory; `DTJ-159` (S) GET /inventory-import-template — шаблон Excel/CSV для аптек без автоматизации; `DTJ-165` (S) CommerceMlParserPort + MockCommerceMlParserAdapter (R1 — порт и мок, без реального XML-парсера); `DTJ-166` (L) Scaffolding apps/pharmacy — первый экран кабинета аптеки (shell, роутер, авторизация)
- Под-волна 3: `DTJ-142` (S) Миграция расширений схемы БД для синхронизации (Дополнения §10 модуля 22); `DTJ-146` (M) CompositeInventoryMatcherService — штрихкод, кэш, точное совпадение (D-06 шаги 1-2); `DTJ-150` (M) RunNightlyFullSyncFanoutUseCase — ночной триггер полной синхронизации 03:00; `DTJ-153` (S) BullMQ-продюсер inventory-sync-queue через transactional outbox; `DTJ-160` (M) XlsxExcelInventoryParserAdapter — парсинг Excel/CSV по заголовку колонки
- Под-волна 4: `DTJ-147` (M) CompositeInventoryMatcherService — trigram fuzzy + неоднозначность + очередь (D-06 шаги 3-4); `DTJ-149` (S) ResolveCatalogMatchQueueItemUseCase — ретроактивное применение резолюции очереди; `DTJ-156` (M) PharmacyApiKeyGuard — HMAC-аутентификация 1С/ERP-канала (D-11)
- Под-волна 5: `DTJ-148` (L) IngestInventoryBatchUseCase — единая точка входа всех каналов; `DTJ-157` (M) POST /inventory/batch-update — контроллер REST-канала (немедленный ACK)
- Под-волна 6: `DTJ-151` (M) FullSyncCompletionService — обнуление отсутствующих позиций (§7.4); `DTJ-154` (L) InventorySyncBatchProcessor — BullMQ-воркер, advisory lock, COPY, set-based upsert; `DTJ-158` (XS) GET /inventory-sync-batches/:batchId — статус батча для поллинга 1С; `DTJ-161` (M) POST /inventory-excel-import — контроллер загрузки, разбивка на батчи, sourceUploadId; `DTJ-162` (M) POST /inventory-manual-entry — точечный и массовый ручной ввод (синхронный путь); `DTJ-163` (S) GET /admin/inventory-sync-batches + /:id/errors — отчёт для кабинета аптеки
- Под-волна 7: `DTJ-152` (S) Watchdog зависших full-sync сессий (FULL_SYNC_SESSION_TIMEOUT_MINUTES); `DTJ-155` (S) Обработчик исчерпания retry BullMQ — failed_validation + processing_failed; `DTJ-164` (S) GET /inventory-sync-batches/:sourceUploadId/error-report — скачивание отчёта об ошибках Excel; `DTJ-167` (M) Экран /inventory — точечное редактирование остатка (каталожный автокомплит); `DTJ-169` (M) Экран /inventory/sync-history — история синхронизаций всех каналов; `DTJ-170` (M) k6-нагрузочный тест inventory-sync — 500 item-events/сек, burst 2000/сек (D-05)
- Под-волна 8: `DTJ-168` (L) Экран /inventory — массовая сетка + импорт Excel/CSV с прогресс-баром

**EP-18 — Слой UX** (продолжение) — команда UX-платформа
- Под-волна 4: `DTJ-405` (M) Реализовать формы ввода packages/ui — PhoneInput, OtpInput, Select, RadioGroup, Checkbox, Switch; `DTJ-406` (L) Реализовать обратную связь и оверлеи packages/ui — Toast, Modal/BottomSheet, EmptyState, ErrorState, OfflineBanner, ProgressBar; `DTJ-408` (M) Реализовать навигацию и данные packages/ui — Tabs, Stepper, CursorTable/CursorList, SearchBar, LanguageSwitcher, BrandLogo; `DTJ-409` (M) Реализовать обёртку MapView (MapLibre GL JS) для packages/ui; `DTJ-410` (S) Реализовать FileDropzone и AudioAlertPlayer для packages/ui

**EP-19 — CI/DevOps/тестовая пирамида**: DTJ-424 (нагрузочные k6, включая inventory-sync) готов после
  этой волны; DTJ-418 частично готов — ветку CUJ-6' (1С-синхронизация) можно писать
  уже здесь, ветку CUJ-1 (поиск) — ждать волну 5-6.

### Волна 5

**EP-06 — Умный поиск + ранжирование + автодополнение** — команда/агент EP-06
- Под-волна 1: `DTJ-180` (S) Создать SearchProvider-порт, скелет модуля поиска и контракты search.ts; `DTJ-181` (S) Миграции БД для поиска — pharmacy_reliability_scores, search_query_log, префиксный индекс
- Под-волна 2: `DTJ-182` (M) Реализовать QueryNormalizationService (штрихкод, транслит, схлопывание пробелов); `DTJ-183` (M) Реализовать RankingScoreMapper — доменная формула ранжирования и перенормировка весов; `DTJ-184` (S) Реализовать PharmacyOpeningHoursPolicy — фильтры «открыто сейчас» и «24/7»; `DTJ-186` (M) Реализовать PostgresSearchProvider.suggest() — автодополнение (префикс/триграмма/дедуп); `DTJ-187` (M) Redis-кэширование поиска/автодополнения/trending и защита от cache stampede; `DTJ-191` (M) Заготовка ElasticSearchProvider + SearchProviderCircuitBreaker (R2, форвард-совместимость)
- Под-волна 3: `DTJ-185` (L) Реализовать PostgresSearchProvider.search() — композитный SQL-запрос ранжирования; `DTJ-189` (S) Реализовать SuggestMedicinesUseCase — автодополнение с cold-start историей/trending
- Под-волна 4: `DTJ-188` (M) Реализовать SearchMedicinesUseCase — оркестрация поиска end-to-end
- Под-волна 5: `DTJ-190` (S) Контроллер поиска — GET /medicines/search и GET /medicines/suggest
- Под-волна 6: `DTJ-192` (M) Frontend: SearchBar с автодополнением, debounce, историей и главным экраном
- Под-волна 7: `DTJ-193` (L) Frontend: экран результатов поиска — фильтры, сортировка, список, состояния

**EP-18 — Слой UX** (продолжение) — команда UX-платформа
- Под-волна 5: `DTJ-407` (L) Реализовать доменные витринные компоненты packages/ui — PriceTag, SavingsBadge, AnalogBanner, MedicineCard, PharmacyOfferRow, CountdownTimer, OrderTimeline; `DTJ-411` (M) Реализовать слой темизации и хуков Telegram Mini App в packages/ui
- **EP-19 — CI/DevOps/тестовая пирамида**: DTJ-418 можно закрывать полностью (готова ветка CUJ-1 поиск)

### Волна 6

**EP-07 — Analog Engine** — команда/агент EP-07
- Под-волна 1: `DTJ-099` (M) AnalogEquivalenceService — доменное решающее правило эквивалентности препаратов; `DTJ-100` (S) AnalogCandidatesRepository — SQL-предфильтр кандидатов по множеству веществ (top-50); `DTJ-103` (S) i18n-контент блока аналогов (savings/neutral/disclaimer/rx-badge) + i18n_overrides.review_status
- Под-волна 2: `DTJ-101` (L) FindAnalogsUseCase — оркестрация подбора аналогов, расчёт экономии, AnalogOfferLookupPort
- Под-волна 3: `DTJ-102` (M) GET /api/v1/medicines/:id/analogs — контроллер, DTO, Rx-бейдж, дисклеймер
- Под-волна 4: `DTJ-104` (M) Frontend AnalogsBlock — плашка экономии, нейтральный заголовок, дисклеймер, Rx-бейдж

**EP-08 — Карта аптек** — команда/агент EP-08
- Под-волна 1: `DTJ-194` (XS) Scaffolding: контракты и порт репозитория карты аптек (pharmacies-map)
- Под-волна 2: `DTJ-195` (M) Реализовать PostgresPharmacyMapRepository — bbox-запрос пинов аптек; `DTJ-198` (M) Frontend: обёртка MapView на MapLibre GL JS с self-hosted vector-тайлами
- Под-волна 3: `DTJ-196` (S) Реализовать GetPharmacyMapPinsUseCase — валидация bbox и обогащение «открыто сейчас»
- Под-волна 4: `DTJ-197` (XS) Контроллер карты — GET /api/v1/pharmacies/map
- Под-волна 5: `DTJ-199` (L) Frontend: экран /map — карта аптек, фильтры, точки входа с главного экрана и карточки товара

**EP-09 — Корзина + Checkout** — команда/агент EP-09
- Под-волна 1: `DTJ-220` (M) Скаффолдинг модуля orders — миграция Group D, каркас модуля, контракты
- Под-волна 2: `DTJ-221` (M) Order/OrderItem: доменная сущность и инварианты создания; `DTJ-223` (M) Cart: управление позициями и мультиаптечная группировка
- Под-волна 3: `DTJ-222` (L) Order: полная state machine переходов статусов (вкл. D-25 confirmed) и публичный фасад; `DTJ-224` (M) Cart: мягкий резерв остатка (Redis TTL) и AvailabilityCalculator
- Под-волна 4: `DTJ-225` (S) Cart: живой пересчёт цены/остатка при просмотре и предупреждения; `DTJ-227` (L) CheckoutUseCase: оркестрация, сплит по аптекам, частичный успех; `DTJ-232` (M) CancelOrderUseCase — отмена заказа по всем веткам жизненного цикла
- Под-волна 5: `DTJ-226` (M) Cart: REST API, merge гостевой корзины при логине; `DTJ-228` (M) Checkout: расчёт стоимости, снэпшот комиссии, billing_strategy; `DTJ-229` (M) Checkout: адрес/ориентир и валидация способа оплаты (COD-политика); `DTJ-230` (M) Checkout: Rx-исключение позиций и синхронный confirm для cash_courier (D-25)
- Под-волна 6: `DTJ-231` (M) Checkout: идемпотентность и конкурентность (гонки, дрейф цены, двойной клик); `DTJ-234` (M) Frontend: экран корзины (apps/web/features/cart)
- Под-волна 7: `DTJ-233` (M) Checkout: REST-эндпоинты POST /orders, POST /orders/:id/cancel, маппинг ошибок
- Под-волна 8: `DTJ-235` (M) Frontend: экран оформления заказа (apps/web/features/checkout)

**EP-19 — CI/DevOps/тестовая пирамида**: DTJ-421 (CUJ-9/CUJ-10) можно закрывать не позднее этой точки

### Волна 7

**EP-10 — Оплата наличными + Escrow-ledger** — команда/агент EP-10
- Под-волна 1: `DTJ-236` (M) Скаффолдинг модуля payments — миграция Group E, каркас модуля, контракты; `DTJ-253` (S) UnpaidOrderTimeoutJob — авто-отмена неоплаченного non-cash заказа
- Под-волна 2: `DTJ-237` (S) PaymentProvider: порт и общие типы; `DTJ-240` (S) EscrowLedger: доменный агрегат двойной записи (append-only)
- Под-волна 3: `DTJ-238` (M) MockBankProvider: детерминированный адаптер + авто-вебхук; `DTJ-245` (M) RefundOrderUseCase — полный рефанд, реализация RefundFacadePort, NOOP для cash; `DTJ-247` (S) EscrowReconciliationJob — ежедневная сверка инварианта ledger; `DTJ-248` (M) GET /orders/:id/ledger — API поверх эскроу-леджера с ролевой видимостью
- Под-волна 4: `DTJ-239` (S) AlifMobiProvider/DcNextProvider: заготовки адаптеров (R3, порт готов R1); `DTJ-241` (M) CreatePaymentInvoiceUseCase — реализация PaymentInvoicePort + retry-payment; `DTJ-242` (L) HandlePaymentWebhookUseCase — HMAC → идемпотентность → markPaidEscrow + recordHold; `DTJ-254` (S) PickupSlaTimeoutJob — авто-отмена несобранного заказа (обе ветки: cash и non-cash)
- Под-волна 5: `DTJ-243` (M) Webhook: пограничные случаи (неизвестный платёж, out-of-order, поздняя оплата); `DTJ-244` (M) CaptureEscrowUseCase — захват комиссии/выплаты аптеке при доставке, NOOP для cash; `DTJ-246` (M) AdjustLedgerUseCase + AdminPaymentOverrideUseCase — контролируемые исключения; `DTJ-255` (S) EscrowInvariantSpec — сквозной гейт-тест инварианта D-25 (SRS-ORD-027a/SRS-DOM-180)
- Под-волна 6: `DTJ-249` (S) PayoutSchedulerJob (pending→due) + контракт заморозки по спору; `DTJ-251` (M) CashCommissionAggregationJob — B2B-инвойс комиссии за cash_courier
- Под-волна 7: `DTJ-250` (M) BankPayoutTransferPort + Mock + PayoutExecutionJob (due→paid); `DTJ-252` (M) Просрочка B2B-инвойса → авто-блокировка сети + отчёты аптеке

**EP-19 — CI/DevOps/тестовая пирамида**: DTJ-419 (CUJ-2' оплата наличными + CUJ-7' White-Label) становится выполним

### Волна 8

**EP-11 — Возвраты (деньги + склад)** — команда/агент EP-11
- Под-волна 1: `DTJ-270` (M) Скаффолдинг модулей returns/support — миграция схемы, каркас модулей, контракты
- Под-волна 2: `DTJ-271` (M) Доменная сущность OrderReturn — инварианты и state machine
- Под-волна 3: `DTJ-272` (S) ReturnFinancialOutcomeResolver — политика «вина → денежный исход»; `DTJ-273` (L) Use case'ы жизненного цикла возврата — request/markInTransit/confirm/reject/override/retry
- Под-волна 4: `DTJ-274` (M) RefundOnReturnResolvedUseCase — рефанд по возврату с учётом стратегии раздельного биллинга
- Под-волна 5: `DTJ-275` (M) REST API возвратов — 7 эндпоинтов, RBAC, идемпотентность
- Под-волна 6: `DTJ-276` (M) apps/web — экран запроса возврата и отслеживания статуса; `DTJ-277` (M) apps/pharmacy — приёмка возврата фармацевтом (чек-лист, confirm/reject)

**EP-12 — Терминал фармацевта (API + веб-кабинет сборки)** — команда/агент EP-12
- Под-волна 1: `DTJ-300` (M) Схема БД и доменные расширения терминала фармацевта (scaffolding)
- Под-волна 2: `DTJ-301` (M) Очередь заказов терминала, приёмка (accept) и перехват (reclaim); `DTJ-302` (L) Сканирование позиции заказа и партийная замена (scan) WARN; `DTJ-303` (S) Сообщение о недоступности позиции (report-issue) WARN
- Под-волна 3: `DTJ-304` (L) Частичная сборка — предложение и подтверждение клиентом; `DTJ-307` (M) SLA-таймер сборки — мягкая эскалация и жёсткий автоотказ
- Под-волна 4: `DTJ-305` (M) Завершение сборки и передача курьеру (complete-picking)
- Под-волна 5: `DTJ-306` (S) OTP вручения — просмотр и регенерация; `DTJ-308` (S) Realtime-события терминала фармацевта (WS)
- Под-волна 6: `DTJ-309` (M) RBAC и межтенантная изоляция — сквозные интеграционные тесты терминала фармацевта; `DTJ-310` (M) apps/pharmacy: экран очереди заказов (Order Queue) + звуковое/визуальное оповещение
- Под-волна 7: `DTJ-311` (L) apps/pharmacy: экран сборки — ручной ввод штрихкода и сообщение о проблеме
- Под-волна 8: `DTJ-312` (M) apps/pharmacy: частичная сборка, завершение сборки и экран OTP вручения

**EP-19 — CI/DevOps/тестовая пирамида**: DTJ-425 (security suite), DTJ-426, DTJ-427 (CI-гейты) формально не
  имеют доменных зависимостей за пределами EP-19 (могли бы выполняться уже с волны 3,
  сразу после DTJ-414) — указаны здесь по внутреннему графу EP-19, реальный резерв
  для DevOps-команды.

### Волна 9

**EP-13 — Курьерский веб-модуль** — команда/агент EP-13
- Под-волна 1: `DTJ-313` (L) Схема БД и доменные сущности модуля delivery (scaffolding)
- Под-волна 2: `DTJ-314` (L) DeliveryFacade и алгоритм подбора курьера (SuggestNearestCourierUseCase); `DTJ-320` (M) Смены курьера и сверка наличных; `DTJ-321` (S) Заработок, выплаты и рейтинг курьера (read-эндпоинты)
- Под-волна 3: `DTJ-315` (L) Создание назначения и цепочка офферов курьеру (offer lifecycle); `DTJ-322` (M) Тарификация и зоны доставки (DeliveryFacade.calculateDeliveryFee)
- Под-волна 4: `DTJ-316` (M) Пул назначений и ручное назначение/переназначение диспетчером; `DTJ-317` (L) Детали назначения и статусные переходы курьера (depart → deliver)
- Под-волна 5: `DTJ-318` (M) Нештатные сценарии доставки (report-issue, mark-failed, refuse-at-door, форс-отмена); `DTJ-319` (M) Геолокация курьера и живой ETA клиента
- Под-волна 6: `DTJ-323` (S) Realtime-события модуля delivery (WS); `DTJ-324` (M) RBAC, политики и межтенантная изоляция модуля delivery — сквозные тесты
- Под-волна 7: `DTJ-325` (M) apps/courier: scaffolding веб-приложения курьера
- Под-волна 8: `DTJ-326` (S) apps/courier: экран смены (старт/финиш, сводка наличных); `DTJ-331` (S) apps/courier: заработок и история выплат
- Под-волна 9: `DTJ-327` (M) apps/courier: офферы и пул назначений
- Под-волна 10: `DTJ-328` (L) apps/courier: экран активной доставки — карта, статусы, ориентиры
- Под-волна 11: `DTJ-329` (M) apps/courier: приём наличных и ввод OTP вручения; `DTJ-330` (S) apps/courier: сообщение о проблеме и отказ на пороге
- Под-волна 12: `DTJ-332` (L) apps/courier: геолокация и офлайн-очередь действий (веб)

**EP-19 — CI/DevOps/тестовая пирамида**: DTJ-420 (CUJ-3' сборка фармацевтом + CUJ-4' доставка курьером) становится выполним

### Волна 10

**EP-14 — Споры (облегчённые) + поддержка** — команда/агент EP-14
- Под-волна 1: `DTJ-278` (M) Доменная сущность SupportTicket — состояние, SLA-поля, миграция расширения
- Под-волна 2: `DTJ-279` (S) CreateSupportTicketUseCase — создание обращения с гардом is_escrow_blocking
- Под-волна 3: `DTJ-280` (S) SupportSlaMonitorJob — эскалация просроченного первого ответа
- Под-волна 4: `DTJ-281` (S) SupportFacade — публичный фасад модуля + авто-создание тикета по просрочке SLA доставки
- Под-волна 5: `DTJ-282` (M) REST API обращений поддержки — создание, список, ответ, резолюция
- Под-волна 6: `DTJ-283` (M) apps/admin — очередь обращений поддержки (список, деталь, SLA-индикация); `DTJ-284` (S) apps/web — создание обращения в поддержку и отслеживание клиентом

**EP-15 — Админ-панель super_admin и кабинет pharmacy_admin** — команда/агент EP-15
- Под-волна 1: `DTJ-350` (M) Скелет модуля admin (backend) и каркас разделов apps/admin для super_admin/pharmacy_admin
- Под-волна 2: `DTJ-351` (S) Админ-панель — тенанты (список/деталь) и PATCH tenant-settings; `DTJ-352` (S) Фиче-флаги — таблица feature_flags и CRUD-экран (глобальные и per-tenant); `DTJ-353` (S) Кросс-тенантный обзор аптек для super_admin; `DTJ-354` (M) Пользователи — поиск/деактивация/смена бытовой роли + grant-platform-role; `DTJ-355` (M) Заказы (super_admin) — кросс-тенантный поиск, деталь с полной таймлайном; `DTJ-357` (M) Финансы — просмотр escrow-ledger, payout-schedule и алертов рассинхронизации; `DTJ-358` (S) Финансы — управление ставками комиссии (commission-rates); `DTJ-359` (L) Финансы — инвойсы cash_courier-комиссии, ручная отметка оплаты и джоба просрочки; `DTJ-360` (S) Настройки платформы — read-only экран process-level ENV-констант; `DTJ-361` (L) Инфраструктура экспорта отчётов — синхронный CSV/XLSX и асинхронная джоба для длинных периодов; `DTJ-364` (M) Кабинет pharmacy_admin — сотрудники (staff-accounts): создание, список, деактивация; `DTJ-365` (L) Кабинет pharmacy_admin — API-ключи 1С (создание, ротация, отзыв, mTLS); `DTJ-367` (S) Кабинет pharmacy_admin — расписание работы и круговая зона доставки
- Под-волна 3: `DTJ-356` (M) Заказы — ручной payment-override и admin-force-cancel с обязательным аудитом; `DTJ-362` (S) Кабинет pharmacy_admin — свои аптеки (обзор) и сводка остатков; `DTJ-363` (S) Кабинет pharmacy_admin — свои заказы (обзорный список сети); `DTJ-366` (M) Кабинет pharmacy_admin — отчёты (продажи, выплаты, история 1С-синхронизации, здоровье остатков)

**EP-16 — NotificationService (Telegram) + audit_log** — команда/агент EP-16
- Под-волна 1: `DTJ-368` (M) Скелет модуля notifications и провайдеры TelegramNotifyProvider/InAppNotifyProvider; `DTJ-374` (M) audit_log — AuditLogPort, append-only репозиторий и REVOKE на уровне БД
- Под-волна 2: `DTJ-369` (M) Таблица notification_templates, сид на tj/ru/en и CI-тест полноты матрицы; `DTJ-372` (S) GET /api/v1/notifications — собственная лента уведомлений (in-app inbox); `DTJ-375` (S) Общий список чувствительных полей и его интеграция с pino и audit_log; `DTJ-377` (S) AuditLogRetentionJob — квартальная батчевая очистка по сроку хранения
- Под-волна 3: `DTJ-370` (L) DispatchNotificationUseCase — матрица событие×роль×канал, фолбэк, ретраи, троттлинг, дедуп; `DTJ-376` (M) GET /api/v1/audit-log и экран журнала аудита для super_admin
- Под-волна 4: `DTJ-371` (M) notification_preferences — тихие часы и переключатели категорий с защитой критичных; `DTJ-373` (S) Админ-экран диагностики недоставленных уведомлений

**EP-19 — CI/DevOps/тестовая пирамида**: DTJ-422 (CUJ-11 Telegram-уведомления + CUJ-12 i18n-инвариант) становится выполним (нужен EP-16)

### Волна 11

**EP-17 — Продуктовая аналитика воронки R1-15** — команда/агент EP-17
- Под-волна 1: `DTJ-378` (M) Скелет модуля analytics, AnalyticsFacade.recordEvent и таблица product_events
- Под-волна 2: `DTJ-379` (S) POST /api/v1/analytics/events — приём клиентской UX-телеметрии (батч, fire-and-forget); `DTJ-380` (M) Событие order_placed из CheckoutUseCase и расчёт реализованной экономии; `DTJ-382` (M) GET /api/v1/analytics/platform-metrics и дашборд платформенных метрик; `DTJ-384` (S) GET /api/v1/analytics/onboarding-funnel и экран воронки онбординга аптек
- Под-волна 3: `DTJ-381` (M) GET /api/v1/analytics/funnel и экран воронки в apps/admin (по дизайн-референсу); `DTJ-383` (S) Отчёт «Топ аналогов по показанной экономии» — backend и таблица в apps/admin

**EP-19 — CI/DevOps/тестовая пирамида**: DTJ-423 (CUJ-13 воронка аналитики + brand-инвариант) становится выполним (нужен EP-17)

### Волна 12

**EP-19 — CI/DevOps/тестовая пирамида** — команда/агент EP-19
- Под-волна 1: `DTJ-412` (L) Собрать Docker Compose стек dev/staging/prod (Postgres/Redis/MinIO/Nginx/apps) + multi-stage Dockerfile'ы; `DTJ-415` (M) Построить tests/arch/ — фикстуры-нарушители и тест, что arch:check/lint их отвергают; `DTJ-416` (M) Собрать packages/testing-kit — детерминированные тест-дублёры (Clock/Id/Otp) и builder-фабрики
- Под-волна 2: `DTJ-413` (XS) Собрать эфемерный docker-compose.test.yml для integration/e2e прогонов; `DTJ-424` (M) Построить нагрузочные тесты k6 (поиск, 1С-ingestion, checkout) и еженедельный CI-job; `DTJ-428` (M) Подготовить автоматизацию релиза (rolling-деплой, откат) и чек-лист готовности к продакшену
- Под-волна 3: `DTJ-414` (L) Настроить GitHub Actions CI-пайплайн (typecheck/lint/arch, unit, integration, security, build, e2e, release); `DTJ-417` (L) Построить каркас E2E-инфраструктуры Playwright (конфиг, помощники OTP/Telegram, axe, фикстуры)
- Под-волна 4: `DTJ-418` (M) Реализовать E2E: CUJ-1 (поиск и аналоги) и CUJ-6' (Excel/1С-синхронизация остатков); `DTJ-419` (M) Реализовать E2E: CUJ-2' (заказ с оплатой наличными) и CUJ-7' (White-Label/изоляция тенантов); `DTJ-420` (L) Реализовать E2E: CUJ-3' (сборка фармацевтом) и CUJ-4' (доставка курьером); `DTJ-421` (M) Реализовать E2E: CUJ-9 (модерация и онбординг аптеки) и CUJ-10 (поток авторизации); `DTJ-422` (M) Реализовать E2E: CUJ-11 (Telegram-уведомления вне TWA) и CUJ-12 (i18n-инвариант); `DTJ-425` (L) Построить security test suite (SQLi/XSS/SSRF/CSRF/DoS/rate-limit/file-upload) и pnpm audit гейт; `DTJ-426` (S) Реализовать CI-гейт env:check (.env.example vs Zod-схема конфигурации) WARN; `DTJ-427` (S) Реализовать CI-гейт бюджета JS первого экрана (pnpm size-check, ≤250KB gzip) WARN
- Под-волна 5: `DTJ-423` (M) Реализовать E2E: CUJ-13 (воронка аналитики экономии) и инвариант смены бренда (D-01)

---

## Конфликты владения файлами

**Статус: РАЗРЕШЕНО (D-27, `03-ARCHITECT-DECISIONS.md`).** Все находки этого раздела
закрыты протоколом владения файлами D-27: (1) barrel-файлы (`index.ts`, `*.module.ts`,
`package.json`, `tsconfig.json`, `.github/workflows/*.yml`,
`infra/docker/docker-compose*.yml`) удалены из `files_owned` затронутых тикетов и
заменены пометкой в «Риски и подводные камни» каждого тикета («правится ТОЛЬКО
добавлением строки… слияние конфликтов — за архитектором»); (2) точечные блокирующие
конфликты волны 1 (`packages/i18n`, `tests/load/inventory-sync.k6.js`) разрешены явным
единственным владельцем + `depends_on`/`blocks`; (3) пары внутри одной подволны (раздел
C ниже) разведены зависимостью `depends_on` второго тикета пары на первый. Разбор ниже
сохранён как исторический контекст находок — статус разрешения указан при каждом пункте.

Автоматически сверены `files_owned` всех пар из 271 тикета (нормализация `**`-глобов
до директорийных префиксов, пересечение по префиксу пути). Всего найдено 109 пар
тикетов с пересекающимся `files_owned`, у которых при этом нет цепочки `depends_on`
друг к другу (то есть пересечение не объясняется тем, что один тикет буквально
продолжает другой). Ниже — классификация, не полный список всех 109 пар построчно.

### A. Уже описанные и разрешённые правилами `00-EPICS.md` (низкий риск)

Эти категории **не новые находки** — они прямо предусмотрены разделом
«Пересекающееся владение и правило разрешения» `00-EPICS.md`, просто здесь
подтверждено, что реальные `files_owned` тикетов ему соответствуют. Пункты 1 и 3
(оба — `index.ts`) дополнительно формализованы D-27 п.1 (правило barrel-файлов): файл
исключён из `files_owned` всех перечисленных тикетов, замена — пометка в «Риски и
подводные камни» каждого.

1. **`packages/contracts/src/index.ts`** — барабанный экспорт, десятки тикетов из
   разных эпиков (DTJ-005, DTJ-140, DTJ-180, DTJ-194, DTJ-220, DTJ-236, DTJ-270 и
   др.) добавляют в него свою строку экспорта. Правило `00-EPICS.md` п.3: EP-01
   владеет файлом, остальные — только дописывают строку, конфликт решается rebase.
2. **`apps/admin/**`** — `DTJ-075` (EP-03, создаёт каркас `app/`/`pages`) пересекается
   с 20+ тикетами EP-14/EP-15/EP-16/EP-17, которые добавляют файлы в свои
   `features/<own-slice>/**`. Правило `00-EPICS.md` п.1: не конфликт по факту, т.к.
   пересечение только на уровне общего `**`-глоба в `files_owned`, реальные пути не
   пересекаются (кроме одной строки роутинга).
3. **`packages/contracts/src/{errors,permissions}.ts`** — `DTJ-005` (EP-01) <->
   `DTJ-275` (EP-11), `DTJ-282` (EP-14): та же барабанная логика, что и (1).

### B. Новые находки — не покрыты явно ни одним правилом `00-EPICS.md`

**1. `apps/api/src/modules/catalog/catalog.module.ts` — 3 эпика, ~15 пар тикетов**

`DTJ-090/092/094/095/096/097` (EP-04), `DTJ-100/101` (EP-07), `DTJ-180/185` (EP-06) —
все регистрируют свои провайдеры/контроллеры в одном файле NestJS-модуля. В отличие
от `packages/contracts`, для этого файла в `00-EPICS.md` **нет** явного
барабанного-файла-правила (раздел «Пересекающееся владение» перечисляет только
`apps/admin`, `apps/pharmacy`, `packages/contracts`, `audit_log`, корневые конфиги,
`packages/ui`/`packages/i18n` — `catalog.module.ts` не упомянут).
**Разрешено (D-27, п.1 — правило barrel-файлов):** `catalog.module.ts` (как и любой
`*.module.ts`) исключён из `files_owned` ВСЕХ тикетов, где он встречался
(`DTJ-090/092/094/095/096/097/100/101/180/185`) и заменён пометкой в «Риски и
подводные камни» каждого тикета. Дополнительно пара `DTJ-094` (первый, создаёт
модуль) ↔ `DTJ-095/096/097` (одна подволна EP-04) разведена явным
`depends_on: DTJ-094` (раздел C ниже) — не полагаемся на rebase «на месте».

**2. `packages/i18n/{package.json,tsconfig.json,src/index.ts,src/use-t.ts}` —
`DTJ-004` (EP-01) против `DTJ-400`/`DTJ-402` (EP-18)**

Оба тикета создают (не расширяют) один и тот же пакет с нуля, оба — "root"-тикеты
(`depends_on: []`), оба запланированы на волну 1. `00-EPICS.md` сам предвидел
параллельный бутстрап ("параллельно, меньшим составом бутстрап packages/i18n... нужен
уже здесь"), но не свёл это к конкретному разрешению конфликта файлов — в текущем
виде **оба тикета в один день создают `packages/i18n/package.json`**, что гарантирует
либо дублирование работы, либо merge-конфликт "кто первый закоммитил".
**Разрешено (D-27, п.2, вариант (a)):** `DTJ-004` (EP-01) — единственный владелец
создания пакета `packages/i18n`. `DTJ-400` (EP-18) переформулирован: инициализирует
ТОЛЬКО `packages/ui`, получил `depends_on: [DTJ-004]`, все пути `packages/i18n/**`
убраны из его `files_owned`; `packages/i18n` потребляется как готовая зависимость.
(`DTJ-402` уже имел `depends_on: [DTJ-400]` и остаётся владельцем полного ядра
`packages/i18n` — словари всех модулей, форматирование, `i18n-provider` — вне
точечного разрешения этого конфликта, отдельно от минимального скелета `DTJ-004`.)

**3. `tests/load/inventory-sync.k6.js` — `DTJ-170` (EP-05) и `DTJ-424` (EP-19)**

Оба тикета перечисляют **один и тот же путь файла** в своём `files_owned`. По
таблице владения файлами `00-EPICS.md`, весь каталог `tests/{e2e,load,arch}/**`
закреплён за EP-19 — значит `DTJ-170` дублирует ответственность за файл, который
по документу принадлежит `DTJ-424`. **Разрешено (D-27, п.2):** `tests/load/inventory-
sync.k6.js` убран из `files_owned` `DTJ-170`; `DTJ-170` получил `blocks: [DTJ-424]` и
остаётся владельцем seed-фикстур/README для нагрузочного сценария (EP-05 поставляет
данные и реализованный эндпоинт); сам k6-скрипт — единолично `DTJ-424` (EP-19), пишется
на основе эндпоинта из `DTJ-170`.

**4. `apps/api/src/db/schema/orders.ts` и
`.../orders/application/ports/inventory-facade.port.ts` — `DTJ-220` (EP-09, волна 6)
и `DTJ-300`/`DTJ-302` (EP-12, волна 8)**

`DTJ-300` явно "обновляет" схему `orders.ts`, добавляя терминал-специфичные
enum/колонки поверх созданной `DTJ-220`. Риск ниже, чем у пунктов 1-3, т.к. волны
строго последовательны (6 → 8, не параллельно) — конфликта одновременной записи не
будет. Единственная рекомендация: разработчик `DTJ-300` обязан перечитать актуальное
состояние `orders.ts`/`inventory-facade.port.ts` к волне 8 (могли получить правки от
EP-10 между волнами 6 и 8), а не ориентироваться на снэпшот из текста тикета `DTJ-220`.

**5. `apps/api/package.json` — `DTJ-012`/`DTJ-021` (оба EP-01, одна и та же
под-волна 2) и `DTJ-098` (EP-04)**

`DTJ-012` и `DTJ-021` — сиблинги (оба зависят только от `DTJ-001`, друг от друга не
зависят), оба добавляют зависимости в `package.json` в одной под-волне 2 EP-01 —
технически может достаться разным разработчикам одновременно. `DTJ-098` (EP-04,
волна 2) добавляет ещё одну зависимость в тот же файл в той же волне из другого
эпика. **Разрешено (D-27, п.1 — правило barrel-файлов):** `apps/api/package.json`
(как любой `package.json`/`tsconfig.json`) исключён из `files_owned` всех трёх
тикетов и заменён пометкой в «Риски и подводные камни» каждого («правится ТОЛЬКО
добавлением строки… слияние конфликтов — за архитектором»).

### C. Конфликты внутри одной под-волны (заблокируют одновременную раздачу разным
разработчикам, если не развести вручную)

**Статус: РАЗРЕШЕНО (D-27, п.2 таблица и общее правило).** Каждая пара ниже разведена
явным `depends_on` второго тикета на первый (порядок выбран по принципу «кто создаёт
основу — первый»); для barrel-файлов (`packages/ui/src/index.ts`, `ci.yml`,
`catalog.module.ts`) дополнительно применено правило п.1 (файл убран из `files_owned`,
пометка в «Риски и подводные камни»).

| Пара | Эпик, под-волна | Общий файл | Разрешение |
|---|---|---|---|
| DTJ-057 <-> DTJ-059 | EP-02, под-волна 7 | `packages/contracts/src/tenancy.ts` | `DTJ-059.depends_on` += `DTJ-057` (первым правит `DTJ-057`) |
| DTJ-302 <-> DTJ-303 | EP-12, под-волна 2 | `pharmacy-terminal-items.controller.ts` | `DTJ-303.depends_on` += `DTJ-302` (scan первым, report-issue вторым) |
| DTJ-405 <-> DTJ-406/408/409/410 | EP-18, под-волна 4 | `packages/ui/src/index.ts` (barrel) | файл убран из `files_owned` всех пяти; `DTJ-406/408/409/410.depends_on` += `DTJ-405` (первый в подволне) |
| DTJ-426 <-> DTJ-427 | EP-19, после DTJ-414 | `.github/workflows/ci.yml` (barrel) | файл убран из `files_owned` обоих; `DTJ-427.depends_on` += `DTJ-426` |
| DTJ-094 <-> DTJ-095/096/097 | EP-04, под-волны 4-6 | `catalog.module.ts` (barrel) | файл убран из `files_owned` всех четырёх; `DTJ-095/096/097.depends_on` += `DTJ-094` (см. находку B.1) |

---

## Проблемы

### Висячие зависимости (`depends_on` на несуществующий ID)

**Не найдено.** Проверены все `depends_on` всех 271 тикетов на существование ID в
общем реестре — 100% ссылок валидны.

### Циклы в графе зависимостей

**Не найдено.** См. раздел «Граф зависимостей» — полный DAG-проход подтверждает
отсутствие обратных рёбер.

### Тикеты без `srs_refs`

Один: **`DTJ-415`** ("Построить `tests/arch/` — фикстуры-нарушители...", EP-19).
`srs_refs: []` — но это осознанное решение, задокументированное прямо в тикете
(раздел «Риски и подводные камни»): требование происходит из
`02-CLEAN-ARCHITECTURE-AND-CODE.md` §6.1 (документ уровня 3 в иерархии), а не из
нумерованного корпуса `docs/spec/*.md`, поэтому у него физически нет SRS-ID.
**Не дефект**, но стоит на будущее ввести в конвенцию тикетов отдельное поле
(например `arch_refs`) для источников не-SRS уровня, чтобы автоматическая проверка
"нет ли забытых srs_refs" не спотыкалась об этот легитимный случай каждый раз.

### Тикеты без критериев приёмки

**Не найдено.** Все 271 тикетов содержат секцию `## Критерии приёмки`.

### Дыры в нумерации

**Не найдено внутри диапазонов** (внутри каждого `DTJ-0xx..0yy` эпика номера идут
подряд без пропусков). Промежутки МЕЖДУ диапазонами эпиков (например `DTJ-031..049`
между EP-01 и EP-02, `DTJ-105..139` между EP-04/EP-07 и EP-05) — это
**задокументированный резерв**, явно описанный в шапке `ep01-foundation/README.md`
("Диапазон ID: DTJ-001..DTJ-030 (в резерве DTJ-031..049, не использовать без
согласования Tech Lead)") и аналогично для остальных эпиков. Не дефект.

### Покрытие R1-1..R1-16 (`04-SCOPE-DECISION-PIVOT.md` §3.1) тикетами

Все 16 возможностей R1 сверены с эпиками (по таблице `00-EPICS.md`) и точечно — с
реальными тикетами (заголовки/файлы/срс-рефы). **Непокрытых возможностей R1-1..R1-16
не найдено** — 100% закрыты хотя бы одним тикетом:

| R1-* | Возможность | Эпик(и) | Подтверждено тикетами |
|---|---|---|---|
| R1-1 | Analog Engine (МНН, эквивалентность, экономия) | EP-07 | DTJ-099..104 |
| R1-2 | Каталог (medicines/substances/…, seed >=300) | EP-04 | DTJ-090..098 (DTJ-098 — seed) |
| R1-3 | Умный поиск (FTS, опечатки, тадж. кириллица, транслит) | EP-06 | DTJ-180..193 (DTJ-182 — транслит/нормализация) |
| R1-4 | Мультиаптечные цены/остатки, last_synced_at | EP-05, EP-06 | DTJ-140..170, DTJ-183/185 |
| R1-5 | Приём данных 3 канала + composite-матчинг | EP-05 | DTJ-146/147/157/160/161/162 |
| R1-6 | Карта аптек (MapLibre/OSM) | EP-08 | DTJ-194..199 |
| R1-7 | Корзина/checkout, TTL-резерв, мультиаптечный сплит | EP-09 | DTJ-220..235 |
| R1-8 | Оплата наличными + escrow-ledger, MockBankProvider | EP-10 | DTJ-236..255 (MockBankProvider — DTJ-238) |
| R1-9 | Кабинет аптеки (веб) | EP-12 | DTJ-300..312 |
| R1-10 | Курьерский веб-модуль, OTP вручения | EP-13 | DTJ-313..332 |
| R1-11 | Админ-панель (модерация, лицензии D-22, финансы) | EP-15 (+EP-03 модерация) | DTJ-350..367, DTJ-063..076 |
| R1-12 | Auth: OTP, JWT, RBAC 5 ролей, MockSmsProvider | EP-01 | DTJ-022..030 (MockSmsProvider — DTJ-023) |
| R1-13 | Telegram-бот + Telegram Mini App (TWA) | EP-16 (+EP-01/EP-18 TWA) | DTJ-368..377, DTJ-027, DTJ-411, DTJ-419, DTJ-422 |
| R1-14 | i18n tj/ru/en, дефолт tj, словари по API | EP-18 | DTJ-400..402 (GET /api/v1/i18n/:locale — DTJ-402/DTJ-018) |
| R1-15 | Продуктовая аналитика (воронка экономии) | EP-17 | DTJ-378..384 |
| R1-16 | Мультитенантность на уровне схемы/репозиториев | EP-02 | DTJ-050..062 |

Дополнительно (не входят напрямую в R1-1..R1-16, но обязательны к сдаче R1 по явной
оговорке `00-EPICS.md` — D-09 возвраты, D-24 споры): **EP-11** (DTJ-270..277) и
**EP-14** (DTJ-278..284) присутствуют и укомплектованы тикетами.

### Дополнительная находка методологического характера

`depends_on` каждого тикета кодирует только внутриэпиковые связи (см. врезку в начале
документа) — из 271 тикета 19 корневых (`depends_on: []`) на самом деле заблокированы
на уровне эпика от одного до восьми эпиков вперёд (пример: `DTJ-313`, EP-13, волна 9,
но формально «свободен» как DTJ-001 волны 1). Это не дефект отдельного тикета — так
сделаны все 19 эпиков одинаково, конвенция сознательная — но это означает, что **любой
будущий tooling, автоматически вычисляющий волны только по `depends_on` тикетов (без
оверлея `00-EPICS.md`), даст неверный план запуска**. Рекомендация: либо продублировать
эпик-уровневую зависимость первого тикета каждого эпика явным `depends_on` на последний
тикет предыдущего блокирующего эпика (например `DTJ-313: depends_on: [DTJ-312]`),
либо ввести отдельное поле `epic_depends_on` в frontmatter, синхронизированное с
`00-EPICS.md`, чтобы граф был самодостаточным без ручного оверлея, который сделан в
этом документе.
