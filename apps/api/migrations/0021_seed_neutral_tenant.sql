-- 0021_seed_neutral_tenant.sql
--
-- КОНТЕКСТ (решение CTO, дедлок на свежей БД): `TenantScopeGuard` (APP_GUARD,
-- `apps/api/src/common/guards/tenant-scope.guard.ts`) проверяет `store.unresolved`
-- раньше проверки `@Public()`. `TenantResolutionMiddleware.resolveNeutral()` ищет
-- тенанта со slug `neutral` через `findBySlug` — до этой миграции такой строки
-- в `tenants` не существовало нигде, кроме seed-скрипта каталога (который,
-- ко всему прочему, эту вставку сейчас не выполняет — см. отчёт), поэтому
-- на свежесмигрированной БД АБСОЛЮТНО ЛЮБОЙ запрос получал 500 ещё до того, как
-- появлялась возможность засеять данные. Замкнутый круг для healthcheck'а
-- Docker Compose (`GET /ready`).
--
-- Нейтральный тенант — не бизнес-данные, а системный инвариант: slug `'neutral'`
-- зашит константой в нескольких местах кода (`tenant.entity.ts`,
-- `tenant-resolution.middleware.ts`, `tenant-scope.guard.ts`). Раз система не
-- способна обслужить ни одного запроса без этой строки — она заводится
-- миграцией, а не пользовательским seed-скриптом.
--
-- Значения (id, slug, is_neutral, courier_sourcing_mode, custom_domain_status,
-- brand_name, brand_palette, SLA-дефолты) взяты 1:1 из
-- `apps/api/src/db/seed/tenants/neutral.seed.ts`, чтобы обе вставки описывали
-- одну и ту же строку и НЕ конфликтовали друг с другом. И `tenants`, и парная
-- `tenant_settings` вставляются здесь: `DrizzleTenantRepository.attachSettings`
-- через маппер `tenantFromDb` возвращает `null`, если у тенанта нет строки в
-- `tenant_settings` (агрегат считается неконсистентным без settings) — одной
-- строки в `tenants` недостаточно, чтобы `findBySlug('neutral')` дал рабочий
-- агрегат.
--
-- Идемпотентность (SRS-DB-037): `ON CONFLICT (id) DO NOTHING` / `ON CONFLICT
-- (tenant_id) DO NOTHING` — повторный прогон этой миграции, а также последующий
-- запуск `pnpm db:seed`, не создают дубль и не падают на конфликте.
--
-- ID — ВАЛИДНЫЙ UUID v4 (`...-4000-8000-...`), и это не косметика. Домен читает
-- строку через `TenantId.from()` (`tenancy/domain/value-objects/tenant-id.vo.ts`),
-- который валидирует вход через `uuid.validate()`. Прежнее значение
-- `00000000-0000-0000-0000-000000000001` (скопированное сюда «1:1» из
-- `neutral.seed.ts`) валидацию НЕ проходит: нулевой version-ниббл — это не v1..v8
-- и не nil-UUID. Postgres такой литерал принимает (тип `uuid` не проверяет версию),
-- поэтому дефект был невидим на уровне БД и выстреливал уже в рантайме:
-- `findBySlug('neutral')` → `tenantFromDb` → `TenantId.from(...)` → `ValidationError`,
-- перехват в `TenantResolutionMiddleware` → `unresolved: 'technical'`, то есть
-- нейтральный fallback не работал бы вообще ни для одного запроса.
-- Дополнительно: `ON CONFLICT (id)` защищает только от конфликта по id — строка
-- с ДРУГИМ id и тем же `slug='neutral'` даёт 23505 по `tenants_slug_key`. Поэтому
-- id обязан быть один и тот же во всех источниках (миграция, `neutral.seed.ts`,
-- фикстуры интеграционных тестов), иначе миграция падает на уже засеянной БД.

INSERT INTO tenants (id, slug, is_neutral, courier_sourcing_mode, custom_domain_status)
VALUES ('00000000-0000-4000-8000-000000000001', 'neutral', true, 'platform_pool', 'none')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_settings (
  tenant_id, brand_name, brand_palette, default_locale,
  cod_limit_diram, hold_period_days, pickup_sla_minutes, pickup_sla_buffer_minutes,
  delivery_sla_city_minutes, delivery_sla_remote_minutes, dispute_window_hours,
  inventory_delta_sla_minutes, return_restock_min_remaining_days
)
VALUES (
  '00000000-0000-4000-8000-000000000001', 'DoruTJ', '{
    "--brand-primary": "#64748b",
    "--brand-primary-hover": "#475569",
    "--brand-secondary": "#94a3b8",
    "--brand-accent": "#0ea5e9",
    "--brand-bg": "#ffffff",
    "--brand-surface": "#f8fafc",
    "--brand-text": "#0f172a",
    "--brand-text-muted": "#64748b",
    "--brand-border": "#e2e8f0",
    "--brand-success": "#16a34a",
    "--brand-danger": "#dc2626",
    "--brand-warning": "#d97706",
    "--brand-radius": "8px",
    "--brand-font-family": "system-ui, sans-serif"
  }', 'tj',
  50000, 1, 7, 5,
  240, 1440, 24,
  5, 30
)
ON CONFLICT (tenant_id) DO NOTHING;
