# DoruTJ — Модуль TENANCY: мультитенантность и White-Label платформа

> Владелец: Analyst (SRS). Статус: **BASELINE для фазы Analysis**.
> Приоритет источников при противоречии: `04-SCOPE-DECISION-PIVOT.md` > `03-ARCHITECT-DECISIONS.md` (D-*)
> > `00-PROJECT-CHARTER.md` (CUJ-*, §) > `research/00-RESEARCH-DIGEST.md` (REQ-*) > `tz.log` (§ТЗ).
> **ЗАКОН для этого документа**: `10-domain-model.md` (контекст `tenancy`, агрегат `Tenant`,
> `SRS-DOM-042..051`), `11-database-schema.md` (`tenants`, `tenant_settings`, `pharmacy_chains`,
> `platform_fee`), `12-api-conventions-auth-tenancy.md` (§5 «Мультитенантность», §3.5 Telegram,
> §3.6 1С, §9 CORS). Этот документ НЕ переопределяет их — там, где он расширяет схему/контракт,
> расхождение явно помечено разделом «Дополнения к схеме БД» (обоснование обязательно).
>
> Идентификаторы требований: **SRS-TEN-nnn**. Тестовые сценарии: **TC-TEN-nnn**.
> Покрывает: **CUJ-7** (устав), **ЧАСТЬ III** `tz.log` («ФОРМАТ И СТРУКТУРА WHITE-LABEL ПЛАТФОРМЫ»).

---

## 0. Разбиение по релизам

> Основание: `04-SCOPE-DECISION-PIVOT.md` §2.2 «Архитектура (слои, порты, tenant-скоуп, ledger)
> закладывается сразу и целиком — ретрофит мультитенантности... стоит дороже, чем сделать её с первого
> дня». Правило применяется буквально: механизм мультитенантности — R1 целиком; **включение
> ВТОРОГО активного тенанта** (реальная сеть, реальный домен, реальный бот, реальные мерчант-креды) —
> R3, потому что заблокировано внешней зависимостью (подписанный LOI/оплаченный пилот, §5 R3-2).

| Область | R1 (сейчас) | R2 | R3 (заблокировано внешним) |
|---|---|---|---|
| Схема `tenants`/`tenant_settings`/`pharmacy_chains`, `tenant_id`-скоуп, guard, кэш резолвинга | ✅ целиком | — | — |
| Алгоритм резолвинга Host→Slug→neutral, кэш Redis, локальная разработка мульти-тенанта | ✅ целиком (работает уже для 1 нейтрального + демо-сети из seed) | — | — |
| Тест на утечку данных между тенантами (обязательный, Charter §3.4) | ✅ | — | — |
| Движок брендинга: `tenant_settings` палитра/лого/favicon/шрифт, CSS-переменные в рантайме, i18n `brand.name`, запрет хардкода + lint-правило | ✅ (нейтральный тенант ОБЯЗАН пройти через тот же движок — иначе E2E-тест смены `BRAND_NAME` невозможен) | Тема во Flutter из API | Конфигуратор брендинга в `apps/admin` для САМООБСЛУЖИВАНИЯ White-Label клиента |
| Комиссии/тарифы per-tenant (`platform_fee`, D-03) | ✅ (нужны для собственных ставок DoruTJ rx/otc/parapharma) | — | Коммерческие переговоры ставок с конкретной сетью |
| Хранилище платёжных кредов тенанта (`merchant_credentials_ref`, `SecretsVaultProvider` порт + Mock) | ✅ порт + Mock | — | Реальный `AlifMobiProvider`/`DcNextProvider` с реальными мерчант-кредами сети |
| Множественные Telegram-боты на одном backend (роутер по токену, порт хранения токена) | ✅ механизм (работает для 1 бота нейтрального тенанта) | — | Реальный второй бот под брендом сети (`@SifatPharmaBot`) |
| Кастомные домены: `custom_domain`, DNS-верификация, резолвинг по `Host` | ✅ механизм и DNS-verify flow | — | Реальная привязка домена сети + прод-сертификат |
| White-Label коммерческий прайсинг (`whitelabel_contracts`: setup/monthly/royalty) | Схема таблицы закладывается (ретрофит дороже) | — | Реальный биллинг-цикл с реальной суммой по подписанному договору |
| On-premise поставка (лицензирование, закрытый контур) | Чек-лист и Docker-артефакт готовятся | — | Собственно поставка — только после первого White-Label контракта |

**SRS-TEN-000** [04-SCOPE-DECISION §2.2] Любой код, реализующий резолвинг тенанта, брендинг, RBAC
White-Label-прав, хранение кредов и модель тарифов, обязан быть написан в R1 БЕЗ фиче-флага
«отключить мультитенантность» — упрощение «раз тенант один, можно захардкодить» запрещено и
блокируется тем же e2e-тестом, что проверяет `BRAND_NAME` (Charter §5, D-01).

---

## 1. Глоссарий (кратко; полный — `10-domain-model.md`)

| Термин | Определение |
|---|---|
| Нейтральный тенант | Единственная строка `tenants` с `is_neutral=true`, `slug='neutral'`, `chain_id=NULL` — публичный маркетплейс DoruTJ. Не может быть удалён/переименован (SRS-DOM-042). |
| White-Label тенант | Строка `tenants` с `chain_id` → конкретная `pharmacy_chains`, `is_neutral=false`. |
| Тенант-скоуп | Обязательный `tenant_id`/`chain_id`-фильтр репозитория (Charter §3.4). |
| Брендинг | Совокупность `tenant_settings.brand_*` + `i18n_overrides` — визуальные/текстовые токены тенанта. |
| Провизионинг | Процесс создания нового тенанта из `approved`-заявки `pharmacy_chains` (§7 ниже). |

---

## 2. Модель тенанта

**SRS-TEN-001** [R1] [SRS-DOM-042, `11-database-schema.md` §13] `tenants` — корень: `id`, `slug`
(`TenantSlug` VO, `^[a-z0-9-]{3,32}$`), `chain_id` (NULL только для `neutral`), `custom_domain`,
`is_neutral`, `courier_sourcing_mode`. Ровно одна строка `is_neutral=true` — обеспечено частичным
уникальным индексом `ux_tenants_single_neutral` (БД) и доменным инвариантом (приложение, defense in
depth — двойная защита, т.к. это единственная строка, ошибка в которой ломает весь резолвинг §4).

**SRS-TEN-002** [R1] [D-01, D-22] Связь `tenants.chain_id → pharmacy_chains.id` — 1:1 в прикладном
смысле (одна White-Label сеть = один тенант), но на уровне БД не `UNIQUE` намеренно: `ON DELETE
RESTRICT` защищает от осиротевшего тенанта при попытке удалить сеть, `UNIQUE(chain_id) WHERE chain_id
IS NOT NULL` — обязательное дополнение (см. §12 «Дополнения к схеме БД», п.1) — без него ничто не
запрещает создать ВТОРОЙ тенант на ту же сеть, что нарушило бы предположение брендинга «один
White-Label = один визуальный образ».

**SRS-TEN-003** [R1] [REQ-ONBOARD-9] Тенант для сети создаётся НЕ автоматически при `approved`, а
явным провизионингом (§7) ПОСЛЕ `is_whitelabel_requested=true` И `pharmacy_chains.status ∈
{approved, active}` — обычный (не-White-Label) партнёр сети НЕ получает строку `tenants` вообще,
его аптеки продаются через `neutral` (это принципиальное отличие: не каждая `pharmacy_chains` имеет
тенант — только те, кто купил White-Label).

**SRS-TEN-004** [R1] `TenantSettings` (`tenant_settings`, 1:1 с `tenants`) хранит: брендинг (§6),
все per-tenant SLA/лимиты (`cod_limit_diram`, `hold_period_days`, `pickup_sla_minutes`,
`delivery_sla_*`, `dispute_window_hours`, `inventory_delta_sla_minutes`, `default_locale`) —
уже специфицированы `11-database-schema.md` §14, здесь не дублируются. Ставки комиссии/выплаты
курьеру — НЕ здесь (`platform_fee`/`tenant_courier_payout_rules`, §10 ниже).

---

## 3. Резолвинг тенанта

> Алгоритм Host→`X-Tenant-Slug`→`neutral` — уже специфицирован `12-api-conventions-auth-tenancy.md`
> §5 (`SRS-API-041..046`), это ЗАКОН и не переоткрывается. Ниже — то, что относится к МОДУЛЮ tenancy
> (кэш, инвалидация, локальная разработка), не к транспортному контракту.

**SRS-TEN-005** [R1] [Charter §3.4] Слой `infrastructure` модуля `tenancy`: `TenantCacheAdapter`
(порт `TenantCachePort`, реализация Redis) с двумя ключами:
`tenant:by-domain:{host} → tenantId` (TTL `TENANT_DOMAIN_CACHE_TTL_SECONDS`, ASSUMPTION 60) и
`tenant:by-slug:{slug} → tenantId` (тот же TTL). Промах кэша → `TenantRepository.findByDomain/findBySlug`
(Drizzle) → запись в кэш. `TenancyController.updateBranding()`/`attachCustomDomain()` публикуют
`TenantBrandingUpdatedEvent`/`TenantDomainAttachedEvent`, обработчик которых (тот же процесс, синхронно
после commit транзакции) делает `DEL tenant:by-domain:{oldHost}` и `DEL tenant:by-slug:{slug}` —
инвалидация НЕ по TTL, а по событию (60-секундный TTL — подстраховка на случай пропущенной
инвалидации, не основной механизм).

**SRS-TEN-006** [R1] Given Redis недоступен (сетевой сбой/рестарт), When резолвинг тенанта, Then
`TenantCacheAdapter` перехватывает ошибку подключения и обращается напрямую к
`TenantRepository` (graceful degradation — деградация к БД, не отказ запроса); повышенная нагрузка на
Postgres в этом окне — приемлемый компромисс (Charter §7 «падение внешнего провайдера не роняет
систему»). Ошибка кэша логируется `pino.warn`, не `error` (не паника — это ожидаемый деградационный
путь).

**SRS-TEN-007** [R1, ASSUMPTION] Локальная разработка нескольких тенантов на одной машине без
реального DNS: (1) основной путь — заголовок `X-Tenant-Slug: <slug>` в dev-инструментах (Postman/curl/
Playwright fixture `withTenant(slug)`), Host в этом случае — `localhost`, не резолвится ни на один
`custom_domain`, шаг 2 алгоритма срабатывает; (2) для визуальной проверки брендинга в браузере —
запись в `hosts`-файле разработчика (`127.0.0.1 sifat.dorutj.local`) + `vite.config.ts`
`server.allowedHosts` включает `*.dorutj.local`, dev-сертификат не требуется (HTTP на localhost);
(3) `docker-compose.yml` dev-профиль поднимает Nginx с виртуальными хостами
`neutral.dorutj.local`/`sifat.dorutj.local`, оба указывают на один и тот же `apps/api`-контейнер —
демонстрирует резолвинг по `Host` без реальной покупки домена. Seed-данные (`11-database-schema.md`
§«Порядок загрузки seed») создают демо-тенант с `custom_domain='sifat.dorutj.local'` именно для этого
сценария.

**SRS-TEN-008** [R1] `TenantResolutionGuard` (presentation, уже определён `SRS-API-042`) — единственная
точка, где отсутствие резолвленного тенанта останавливает запрос. Модуль `tenancy` дополнительно
предоставляет `@Public()`-декоратор для эндпоинтов, не требующих аутентификации, но ВСЁ РАВНО
резолвящих тенанта (`GET /api/v1/tenant/branding`, `GET /api/v1/meta`, `POST /api/v1/auth/otp/request`)
— различие «публичный» (не требует JWT) и «нетенантный» (не резолвит тенанта) — РАЗНЫЕ декораторы,
эндпоинтов второго типа в системе НЕТ (даже `/health`/`/ready` не проходят через
`TenantResolutionMiddleware`, т.к. это инфраструктурные, не продуктовые маршруты, явно исключены
списком префиксов middleware).

---

## 4. Изоляция данных

**SRS-TEN-009** [R1] [Charter §3.4] Классификация таблиц по типу тенант-скоупа (дополняет
`11-database-schema.md` §«Тенант-скоуп по таблицам», конкретизирует ЗДЕСЬ для ревью модуля):

| Тип | Таблицы | Правило |
|---|---|---|
| **Прямой `tenant_id`** | `users`, `orders`, `cart`, `prescriptions`, `notifications`, `i18n_overrides` | Колонка есть в самой таблице, репозиторий обязан принимать `tenantId` первым параметром (`SRS-API-043`) |
| **Транзитивный через `chain_id`** | `pharmacies`, `pharmacy_inventory`, `inventory_batches`, `payout_schedule`, `courier_earnings`, `platform_billing_invoices` | Тенант один на сеть — `pharmacy_id → pharmacies.chain_id → pharmacy_chains.tenant_id`; репозиторий джойнит цепочку в `WHERE`, не читает `tenant_id` из кэша |
| **Глобально общее (НЕ тенант-скоупное)** | `medicines`, `substances`, `medicine_substances`, `categories` | Единый справочник МНН для ВСЕХ тенантов (научный факт о лекарстве не зависит от тенанта) — сознательно БЕЗ `tenant_id`, любой тенант ссылается на одни и те же строки |
| **Платформенное (видно только `super_admin`)** | `audit_log`, `outbox`, `processed_events`, `platform_fee` (запись с `tenant_id=NULL`) | Не фильтруется по тенанту запроса — доступ регулируется RBAC (`audit-log:read`), не `TenantResolutionGuard` |

**SRS-TEN-010** [R1] [D-06/D-07] Given два тенанта продают один и тот же медикамент (`medicine_id`
идентичен — общий справочник), When один тенант меняет `medicines.description_ru` через
`moderation`-очередь, Then изменение видно ВСЕМ тенантам немедленно (это ожидаемое поведение, не
утечка — справочник намеренно общий, редактирование доступно только `super_admin`/оператору каталога,
не `pharmacy_admin` — иначе один White-Label клиент мог бы испортить данные конкурента, использующего
тот же справочник).

**SRS-TEN-011** [R1] [Charter §3.4, обязательный тест] Каждый Drizzle-репозиторий тенант-скоупной
таблицы реализует общий интерфейс `TenantScopedRepository<T>` (`infrastructure/base`), первый параметр
метода — `tenantId: TenantId` (тип, не строка — `noImplicitOverride`/`strict` не позволяют забыть
параметр, компиляция падает). Метод-нарушитель («забыли передать `tenantId`, отфильтровали только по
`id`») — обнаруживается ДВУМЯ независимыми механизмами: (1) `dependency-cruiser`-правило не может
проверить содержимое SQL, поэтому (2) обязательный параметризованный unit-тест
`tenant-isolation.contract-test.ts`, общий для ВСЕХ репозиториев модуля (запускается для каждого через
`describe.each`): создаёт одинаковый `id` в двух тенантах (или проверяет, что попытка получить чужую
строку по `id` без совпадения `tenantId` возвращает `null`), обязателен в `pnpm verify` для КАЖДОГО
нового репозитория (чеклист ревью §7 `02-CLEAN-ARCHITECTURE-AND-CODE.md`).

**SRS-TEN-012** [R1] [Charter §3.4, CUJ-7] **Обязательный интеграционный тест на утечку** (модульный,
дополняет транспортный `TC-API-030`): given заказ `O1` создан для тенанта A через прямой вызов
`OrdersFacade.placeOrder({ tenantId: A, ... })` (минуя HTTP), when `OrdersFacade.getOrder({ tenantId: B,
orderId: O1.id })`, then репозиторий возвращает `null`/`NotFoundError` — проверяется на уровне
`application`, БЕЗ HTTP-сервера (быстрее, часть `domain`/`application` coverage ≥90%, Charter §5).

---

## 5. Брендинг (D-01)

**SRS-TEN-013** [R1] [D-01] Полный список настраиваемых токенов `tenant_settings` + связанные ключи
`i18n_overrides`:

| Токен | Хранение | Назначение |
|---|---|---|
| `brand_name` | `tenant_settings.brand_name` | Название бренда — ЕДИНСТВЕННЫЙ источник строки «DoruTJ»/«Sifat Pharma» и т.п., подставляется в i18n-ключ `brand.name` |
| `--brand-primary`, `--brand-primary-hover`, `--brand-secondary`, `--brand-accent` | `tenant_settings.brand_palette` (JSONB, ключ = имя CSS custom property) | Основная/вторичная/акцентная палитра |
| `--brand-bg`, `--brand-surface`, `--brand-text`, `--brand-text-muted`, `--brand-border` | `brand_palette` | Фон/поверхность/текст — обязательны для WCAG 2.1 AA контраста 4.5:1 (Charter §5) |
| `--brand-success`, `--brand-danger`, `--brand-warning` | `brand_palette` | Статусные цвета (не переопределяют семантику: успех/ошибка узнаваемы визуально независимо от бренда) |
| `--brand-radius` | `brand_palette` | Радиус скругления компонентов (0 = «квадратный» корпоративный стиль сети) |
| `--brand-font-family` | `brand_palette` (значение — CSS `font-family` стек, напр. `"'Inter', system-ui, sans-serif"`) | Шрифт; см. §12 «Дополнения» — доставка кастомного шрифт-файла ограничена (только Google Fonts или системный стек, см. SRS-TEN-014) |
| `brand_logo_url` | `tenant_settings.brand_logo_url` | Основной логотип (шапка, ширина ≤240px, SVG/PNG прозрачный фон) |
| `brand_logo_square_url` | **[Дополнение схемы]** | Квадратный логотип 512×512 — иконка PWA/Telegram-бота |
| `brand_favicon_url` | **[Дополнение схемы]** | Favicon 32×32 + `apple-touch-icon` 180×180 (один файл, presentation ресайзит на лету через `ObjectStorageProvider` вариант, либо два поля — см. §12) |
| `support_phone`, `support_email` | **[Дополнение схемы]** | Публичные контакты тенанта (не путать с `pharmacy_chains.contact_phone` — тот KYB-контакт юрлица, этот — публичный саппорт для клиентов) |
| `legal.offer_text` (i18n-ключ, per-locale) | `i18n_overrides(tenant_id, locale, 'legal.offer_text')` | Текст оферты/пользовательского соглашения тенанта — использует УЖЕ существующий механизм точечных переопределений, новая таблица не нужна |
| `telegram_bot_username` | `tenant_settings.telegram_bot_username` | Публичное имя бота (для ссылок «открыть в Telegram») |

**SRS-TEN-014** [R1, безопасность] [D-01] Значения `brand_palette` и `brand_font_family` валидируются
Zod-схемой `BrandPaletteSchema` (`packages/contracts`) на запись (`PUT
/api/v1/admin/tenants/:id/branding`) СТРОГИМ allowlist-паттерном: цветовые токены —
`^#[0-9a-fA-F]{6}$` (HEX, без `rgba()`/`url()`/произвольного CSS), `--brand-radius` —
`^\d{1,2}px$`, `--brand-font-family` — фиксированный enum из ≤10 предзагруженных Google Fonts
стеков (`packages/ui` содержит их `@import` заранее — Charter §«Артефакты» правило: только
`fonts.googleapis.com` разрешён CSP) ЛИБО `system-ui, sans-serif` (без произвольной строки). Причина:
`brand_palette` — JSONB, инжектируемый как инлайн-стиль/CSS custom property в `<head>` КАЖДОГО
клиента тенанта; без allowlist администратор с правом `tenancy:manage-branding` (роль
`pharmacy_admin` своей сети, не обязательно `super_admin`) мог бы вписать `url(javascript:...)`
или `</style><script>` — CSS/HTML-инъекция через легитимный, не подозрительный на вид канал
конфигурации. Невалидное значение → `400 VALIDATION_ERROR`, `details.field` указывает конкретный
CSS-токен.

**SRS-TEN-015** [R1] [Charter §5 «Мобильный трафик первичен», D-01] Применение на фронте БЕЗ
пересборки: `index.html` (`apps/web`, `apps/admin`) содержит НЕЙТРАЛЬНЫЕ дефолтные значения
`:root { --brand-primary: #64748b; ... }` (серая нейтральная палитра, зашита в билд как fallback,
НЕ бренд DoruTJ — сама фраза «дефолт = нейтрально-серый» и есть защита от хардкода конкретного
цвета). Bootstrap-скрипт `app/bootstrap-branding.ts` (слой `app`, `02` §5) выполняется ДО монтирования
React: `fetch('/api/v1/tenant/branding')` (кэшируется браузером по `ETag`, SRS-API-059) →
`document.documentElement.style.setProperty(key, value)` для каждого ключа `palette` →
`document.title` и `<link rel="icon">` обновляются из `logoUrl`/`faviconUrl`. Окно «серый дефолт →
бренд» — не более одного RTT к `/tenant/branding` (обычно <50мс с тёплым `ETag`-кэшем) — осознанно
принятый компромисс вместо server-side rendering (не входит в стек, Charter §3.1).

**SRS-TEN-016** [R2] [Charter §3.6] Flutter (`apps/pharmacy_mobile`/`courier_mobile`) запрашивает
тот же `GET /api/v1/tenant/branding` при логине, кэширует ответ в `hive`/`drift` (офлайн-доступность),
строит `ThemeData(primaryColor: ..., ...)` из палитры. Устаревание кэша допустимо (эти клиенты —
внутренний инструмент персонала аптеки/курьера, не первичная витрина бренда для конечного
покупателя) — обновление раз в сутки при следующем логине достаточно, не требует WS-инвалидации.

**SRS-TEN-017** [R1] [D-01, C6 `02-CLEAN-ARCHITECTURE-AND-CODE.md`] Запрет хардкода — ДВА
независимых механизма: (1) ESLint-правило `no-restricted-syntax` на строковые литералы, совпадающие
с regex названий-кандидатов бренда (`/DoruTJ|Sifat|Oson/i`) вне `packages/i18n`/тестовых фикстур —
блокирующая ошибка сборки; (2) обязательный e2e-тест (Charter §5, D-01, R1 критерий приёмки №6):
`BRAND_NAME` неонтрального демо-тенанта меняется через `PUT /branding`, полный прогон Playwright по
customer/admin UI ищет literal-строку старого имени в DOM — совпадение = красный тест.

---

## 6. Кастомизация за 48 часов

**SRS-TEN-018** [R1, ASSUMPTION временных нормативов] Чек-лист запуска нового White-Label тенанта
(таймлайн — обоснование ниже):

| # | Операция | Где | Кто | Требует деплоя? | Требует DNS? | Оценка времени |
|---|---|---|---|---|---|---|
| 1 | Одобрение заявки сети (`pharmacy_chains.status → approved`) | `apps/admin` | `super_admin` | Нет | Нет | Уже пройдено до старта 48ч (отдельный процесс онбординга, `08-5`) |
| 2 | `ProvisionTenantUseCase`: создание `tenants` + `tenant_settings` (дефолтная нейтральная палитра) | `apps/admin` → API | `super_admin` | Нет | Нет | 5 мин |
| 3 | Загрузка лого (2 размера) + favicon, выбор палитры/шрифта из allowlist | `apps/admin` конфигуратор брендинга | `pharmacy_admin` сети (`tenancy:manage-branding`) | Нет (мгновенно через `PUT /branding`, кэш инвалидируется событием, §3) | Нет | 1–4 часа (ожидание ассетов от клиента — не техническое время) |
| 4 | Настройка `custom_domain` + генерация `domain_verification_token` | `apps/admin` | `pharmacy_admin` | Нет | Да — клиент добавляет TXT-запись в свою DNS-зону | 15 мин на инициацию |
| 5 | Ожидание распространения DNS + `POST /custom-domain/verify` | Автоматическая фоновая job (повтор каждые 15 мин, до 48ч) | Система | Нет | Да (DNS propagation — САМЫЙ ДОЛГИЙ шаг, вне контроля DoruTJ) | 1–48 часов (typical TTL) |
| 6 | Выпуск TLS-сертификата для `custom_domain` (Let's Encrypt через Nginx, автоматически при первом успешном резолвинге) | `infra/docker/nginx` | Система (`certbot` cron) | Нет (авто) | Да (после шага 5) | 5–15 мин после верификации |
| 7 | Регистрация Telegram-бота: клиент создаёт бота у `@BotFather`, вставляет токен в форму `apps/admin` | `apps/admin` | `pharmacy_admin` | Нет | Нет | 10 мин |
| 8 | Привязка мерчант-кредов банка (R3 — реальный банк; в R1 достаточно `MockBankProvider`, чтобы демо работало) | `apps/admin` | `pharmacy_admin` (креды передаются НЕ через форму в открытом виде — см. §8) | Нет | Нет | Зависит от банка (недели) — НЕ входит в 48ч техническую готовность |
| 9 | Настройка `commission_bps`/`courier_sourcing_mode` (если отличается от дефолта) | `apps/admin` (только `super_admin`, `tenancy:manage-commission-rates`) | `super_admin` | Нет | Нет | 10 мин |

**SRS-TEN-019** [R1] Обоснование «48 часов»: единственный шаг вне контроля DoruTJ — распространение
DNS (шаг 5), типичное окно 15 минут–48 часов в зависимости от TTL записи у регистратора клиента; ВСЕ
остальные операции (2, 3, 4, 6, 7, 9) — конфигурация через `apps/admin` без единой строки кода и без
`docker compose restart` (Charter §3.4 «редактируется в `apps/admin` без деплоя»), суммарно ≤2 часов
активной работы. «48 часов» — это верхняя граница ожидания DNS, а не технический бюджет DoruTJ;
явно указывается клиенту при продаже White-Label (управление ожиданиями — не техническое решение).

---

## 7. Провизионинг тенанта (use case)

**SRS-TEN-020** [R1] `application/use-cases/provision-tenant.use-case.ts`:
`ProvisionTenantUseCase.execute({ chainId, slug, initialBrandName })`. Предусловия: (1)
`pharmacy_chains.status ∈ {approved, active}`; (2) `pharmacy_chains.is_whitelabel_requested = true`;
(3) `slug` не входит в зарезервированный список (`neutral`, `admin`, `api`, `www`, `app`, `static`) —
`ReservedTenantSlugError` (уже объявлена доменом, SRS-DOM-084 `10-domain-model.md`, здесь
подключается use case-уровнем); (4) на `chain_id` ещё не существует тенанта (`UNIQUE`, §2 п.2). Внутри
`unitOfWork.run()`: создаёт `tenants`, затем `tenant_settings` с дефолтной нейтральной палитрой
(та же, что fallback фронта, SRS-TEN-015 — тенант стартует «без бренда», ждёт шага 3 чек-листа), затем
`courier_sourcing_mode = platform_pool` по умолчанию (сеть не обязана сразу заводить свой флот).
Публикует `TenantProvisionedEvent` (в `outbox`, для будущего аудита/аналитики).

**SRS-TEN-021** [R1] `POST /api/v1/admin/tenants` (роль `super_admin` только — провизионинг НЕ
делегируется `pharmacy_admin`, это платформенное решение о запуске нового White-Label клиента,
отдельная строка биллинга §10). `Idempotency-Key` обязателен (создание тенанта — необратимая
операция с побочными эффектами, дубль на двойной клик недопустим, конвенция SRS-API-009 этого
документа расширяется этим эндпоинтом).

---

## 8. Платёжные креды тенанта

**SRS-TEN-022** [R1, порт+Mock; R3, реальный адаптер] [Charter §3.4 «деньги тенанта идут напрямую на
мерчант-счёт», D-17] `tenant_settings.merchant_credentials_ref` — НЕ сам секрет, непрозрачная строка
(`vault://tenants/{tenantId}/merchant-credentials`), разрешаемая портом `SecretsVaultPort`
(`application/ports`). Две реализации (`infrastructure/adapters`, Provider Pattern Charter §3.3):
`EnvSecretsVaultAdapter` (dev/Mock — читает `SECRETS_VAULT_DRIVER=env`, значения из ENV с префиксом
`TENANT_SECRET_{tenantId}_*`, ТОЛЬКО для dev/CI, никогда prod) и `HashiCorpVaultAdapter`
(`SECRETS_VAULT_DRIVER=vault`, R3 — подключается вместе с первым реальным банковским контрактом).
Выбор — ENV, как любой Provider Pattern (Charter §3.3).

**SRS-TEN-023** [R1] `PaymentsFacade.createInvoice(order)` (модуль `payments`, не `tenancy`) разрешает
`tenantId → merchantCredentialsRef → SecretsVaultPort.resolve(ref) → { merchantId, apiKey }` ПЕРЕД
вызовом `PaymentProvider.createInvoice(amount, merchantCredentials)` — креды прокидываются как параметр
вызова, никогда не кэшируются в памяти дольше одного запроса, никогда не логируются (правило
редакции `SRS-API-068` этого документа распространяется и на разрешённые креды: поле `apiKey`
попадает в `redact`-список по паттерну `*.apiKey`/`*.merchantCredentials`).

**SRS-TEN-024** [R1] [D-17] Ledger DoruTJ (`escrow_ledger`) остаётся УЧЁТНЫМ независимо от того, чей
это тенант — физическое движение денег (капчур/payout) для White-Label тенанта идёт НАПРЯМУЮ на
мерчант-счёт сети через `PaymentProvider`, сконфигурированный её кредами; DoruTJ не является
держателем средств White-Label клиента ни на одном шаге (соответствует Charter §3.4 и D-17
одновременно — ledger нужен ОБОИМ типам тенантов для комиссии/сверки, но физический денежный поток
различается только выбором merchant-кредов в вызове провайдера).

**SRS-TEN-025** [R1] Given `merchant_credentials_ref` не заполнен (тенант ещё не привязал банк, чек-лист
§6 шаг 8 не пройден), When `PaymentsFacade.createInvoice` вызывается для заказа этого тенанта с
`payment_method ∈ {alif_mobi, dc_next}`, Then `503 SERVICE_UNAVAILABLE`
(`details.reason='tenant_payment_not_configured'`) — `payment_method='cash_courier'` остаётся
доступным независимо (не блокируется отсутствием банковских кредов, R1 работает полностью на
наличных + `MockBankProvider`).

---

## 9. Telegram-бот под брендом тенанта

**SRS-TEN-026** [R1 механизм; R3 — второй реальный бот] [tz.log §III, REQ-TG] `tenant_settings.
telegram_bot_token_ref` — ссылка в `SecretsVaultPort` (тот же механизм §8, другой префикс ключа:
`vault://tenants/{tenantId}/telegram-bot-token`). Каждый тенант со своим ботом регистрирует webhook
Telegram на путь `POST /api/v1/webhooks/telegram/:tenantSlug` (путь несёт `tenantSlug` явно — Telegram
не передаёт кастомные заголовки в webhook-запросе, поэтому тенант резолвится ИЗ ПУТИ, не из `Host`,
единственное исключение из общего алгоритма §3 — обосновано физическим ограничением протокола
Telegram Bot API).

**SRS-TEN-027** [R1] `TelegramWebhookRouter` (infrastructure): по `tenantSlug` из пути находит
`tenants.id` → `tenant_settings.telegram_bot_token_ref` → разрешает токен через `SecretsVaultPort` →
проверяет, что токен, зашитый в `secret_token`-заголовок Telegram-запроса (Bot API
`secret_token` параметр `setWebhook`, НЕ путать с HMAC 1С §3.6 родительского документа), совпадает с
сохранённым при регистрации — несовпадение → `401` без обработки апдейта (защита от подделки
webhook-запроса третьей стороной, знающей публичный URL пути). Успех → апдейт передаётся в
`TelegramUpdateHandler`, работающий ОДИНАКОВО для всех тенантов (бизнес-логика бота НЕ дублируется на
тенанта — единственное отличие ботов друг от друга — токен, брендинг сообщений и `username`).

**SRS-TEN-028** [R1] [REQ-TG-5] Троттлинг исходящих сообщений (`≤30/сек общий, ≤1/сек на chat_id`,
`SRS-API` родительский документ упоминает это правило для очереди уведомлений) применяется
НЕЗАВИСИМО на каждый `tenantId` — бот тенанта A, отправляющий много сообщений, не расходует лимит
бота тенанта B (разные токены Telegram = разные лимиты на стороне самого Telegram API, но и очередь
BullMQ использует `rateLimiterKey = "telegram:${tenantId}"`, не общий ключ — иначе всплеск нотификаций
одного White-Label клиента мог бы замедлить доставку нейтральному тенанту, если бы очередь была
общей по ошибке конфигурации).

**SRS-TEN-029** [R1] Given тенант НЕ имеет `telegram_bot_token_ref` (White-Label клиент ещё не прошёл
чек-лист §6 шаг 7, либо это `neutral`-тенант до первого деплоя ENV-бота), When
`NotificationsFacade.send(userId, event)` с `channel='telegram'`, Then канал молча пропускается
(fallback на `sms`/`web_push`, если настроены — Provider Pattern деградации, не ошибка пользователю).

---

## 10. Комиссии и тарифы per-tenant, White-Label прайсинг

**SRS-TEN-030** [R1] [D-03, REQ-MON-8] Ставки комиссии платформы (`platform_fee`, полностью
специфицирована `11-database-schema.md` §25) резолвятся по специфичности
`(tenant_id,chain_id,category) > (tenant_id,chain_id) > (tenant_id,category) > (tenant_id) > global`.
Модуль `tenancy` владеет ТОЛЬКО RBAC-доступом к изменению (`tenancy:manage-commission-rates`,
`super_admin` — не `pharmacy_admin`, ставка комиссии не самообслуживается сетью, это платформенное
финансовое решение, REQ-MON-8 «обязательный аудит изменений» → `created_by` NOT NULL, уже в схеме).

**SRS-TEN-031** [R1, схема; R3, коммерческая эксплуатация] [REQ-MON-10, ASSUMPTION research §16]
Коммерческие условия White-Label (setup fee 15–40 тыс. TJS, monthly fee 3–4 тыс. TJS/10 точек,
опциональный роялти 1–2% от GMV) хранятся в НОВОЙ таблице `whitelabel_contracts` (см. §12
«Дополнения к схеме БД», п.4) — ОТДЕЛЬНО от `tenant_settings`, доступной ТОЛЬКО ролям с финансовыми
правами (`super_admin`; `pharmacy_admin` сети НЕ видит условия своего же контракта через обычный
API — коммерческая тайна условий продажи, доступ к своим финансовым обязательствам — через
выставленный `platform_billing_invoices`, не через сырые условия договора). Эта таблица
принадлежит домену `billing` (не `tenancy`) — модуль `tenancy` только резолвит `tenantId`/`chainId`
для присоединения, полная спецификация биллинг-цикла (`REQ-MON-6/7/9`) — компетенция отдельного
SRS-модуля `billing`, здесь фиксируется ТОЛЬКО факт необходимости этой таблицы (обнаружен пробел
схемы при анализе tenancy).

**SRS-TEN-032** [R1] Роялти (`REQ-MON-11`) считается по `orders`/`chain_id` — БЕЗ отдельного канала
получения данных о продажах тенанта (тенант не может «скрыть» продажи от роялти — данные едины,
это одна БД, не интеграция с внешней системой сети).

---

## 11. On-premise поставка

**SRS-TEN-033** [R3, заблокировано подписанным контрактом; артефакты готовятся в R1] [tz.log §III
«Полный комплект исходного кода... On-Premise в ЦОД Таджиктелеком»] Поставка в закрытый контур сети
требует:

1. **Экспортируемый Docker-бандл**: `docker compose -f infra/docker/docker-compose.onprem.yml`
   (отдельный compose-профиль от dev/prod облачного — без зависимости на публичный MinIO/внешний
   Redis-кластер DoruTJ, всё внутри периметра клиента). Образы публикуются в приватный registry,
   передаваемый клиенту (не Docker Hub — код не публичен).
2. **Лицензионный файл**: `LICENSE_KEY` (JWT, подписанный приватным ключом DoruTJ, публичный ключ
   зашит в образ `apps/api`) с полями `{ chainId, issuedAt, expiresAt, maxPharmacies }` — проверяется
   при старте (`LicenseVerificationGuard`, presentation, глобальный) и периодически (раз в 24ч, чтобы
   истечение лицензии не требовало рестарта для обнаружения); истёкшая/невалидная лицензия → `apps/api`
   продолжает обслуживать уже открытые сессии до конца текущего процесса, но ЛОГИРУЕТ `pino.error`
   критического уровня и `GET /ready` начинает возвращать `503` (не хард-креш посреди рабочего дня
   аптеки — это операционная, не мгновенная авария, деградация видна мониторингу оператора).
3. **Отсутствие внешних вызовов по умолчанию**: on-premise профиль ЗАПРЕЩАЕТ (ENV `OFFLINE_MODE=true`)
   исходящие вызовы к `fonts.googleapis.com` (шрифты — только локально упакованные `woff2` в образе
   `apps/web`, тот же allowlist шрифтов §5, но физически из `packages/ui/assets`, не из сети), к
   публичному Telegram Bot API (если сеть требует полностью изолированный контур — тогда канал
   уведомлений деградирует до `sms`/`web_push`, это явное коммерческое ограничение on-premise
   поставки, не дефект).
4. **Неисключительные права**: юридический текст лицензии (не техническая, договорная часть) —
   исходный код передаётся, встроенная неисключительная лицензия НЕ разрешает клиенту перепродавать
   код как свой продукт третьим сетям (коммерческое решение, вынесено в договор — не техническое
   требование к системе, упомянуто для полноты чек-листа).
5. **Обновления**: on-premise инсталляция НЕ auto-update (в отличие от облачного SaaS-режима) —
   клиент применяет патчи вручную (`git pull` приватного репо + `docker compose pull` + миграции),
   контракт может предусматривать SLA на critical-security патчи (коммерческое условие, не код).

**SRS-TEN-034** [R3] On-premise контур НЕ участвует в общей мультитенантности DoruTJ (это единственный
тенант в изолированной инсталляции — `is_neutral=true` В ЭТОМ контуре, т.к. для локальной установки
концепция «нейтрального публичного маркетплейса» неприменима, весь контур принадлежит одной сети).
Код идентичен облачному (Charter §3.1 «монолит, один кодовая база»), различие — только конфигурация
развёртывания и данные одной строки `tenants`.

---

## 12. Дополнения к схеме БД

> Обоснование каждого пункта — по правилам родительского документа: поле/таблица нужны существующему
> контракту (`12-api-conventions-auth-tenancy.md` уже ссылается на `faviconUrl`/`supportPhone` в
> ответе `GET /tenant/branding`, SRS-API-059, но `tenant_settings` их не содержит — это пробел,
> обнаруженный при спецификации модуля `tenancy`, не самовольное расширение).

**1. `pharmacy_chains` ↔ `tenants` — один тенант на сеть.**

```sql
CREATE UNIQUE INDEX ux_tenants_single_chain ON tenants (chain_id) WHERE chain_id IS NOT NULL;
```
Обоснование: без этого индекса ничто не запрещает создать второй White-Label тенант на ту же сеть
(SRS-TEN-002); `ProvisionTenantUseCase` (SRS-TEN-020) полагается на эту гарантию БД как последний
рубеж (defense in depth, тот же паттерн, что `ux_tenants_single_neutral`).

**2. `tenant_settings` — недостающие поля брендинга/контактов, уже подразумеваемые
`GET /api/v1/tenant/branding` (`SRS-API-059`).**

```sql
ALTER TABLE tenant_settings
    ADD COLUMN brand_logo_square_url TEXT,      -- иконка PWA/Telegram-бота, 512x512
    ADD COLUMN brand_favicon_url TEXT,           -- favicon 32x32 + apple-touch-icon источник
    ADD COLUMN support_phone VARCHAR(20),        -- PhoneNumber VO, публичный контакт (не KYB)
    ADD COLUMN support_email VARCHAR(255),
    ADD COLUMN telegram_bot_token_ref TEXT,      -- ссылка в SecretsVaultPort (SRS-TEN-026)
    ADD COLUMN merchant_credentials_status VARCHAR(20) NOT NULL DEFAULT 'not_configured';
    -- 'not_configured' | 'configured' — быстрая проверка в SRS-TEN-025 без похода в vault
```
Обоснование: `merchant_credentials_ref` (уже в схеме) хранит САМУ ссылку, но проверка «настроено ли
вообще» (SRS-TEN-025) не должна требовать разрешения секрета через `SecretsVaultPort` на каждый
чек чекаута — булев/enum-флаг рядом дешевле и не раскрывает ничего чувствительного.

**3. `tenants` — статус верификации домена (DNS, чек-лист §6 шаг 4–6).**

```sql
CREATE TYPE custom_domain_status AS ENUM ('none', 'pending_verification', 'verified');

ALTER TABLE tenants
    ADD COLUMN custom_domain_status custom_domain_status NOT NULL DEFAULT 'none',
    ADD COLUMN domain_verification_token VARCHAR(64);
CONSTRAINT chk_tenants_domain_status CHECK (
    (custom_domain IS NULL AND custom_domain_status = 'none')
    OR (custom_domain IS NOT NULL)
);
```
Обоснование: §6 чек-лист требует различать «домен указан, но DNS ещё не подтверждён» (не резолвить
по нему — иначе злоумышленник, указавший чужой ещё не свой домен, мог бы временно перехватить
резолвинг) от «домен подтверждён». `TenantResolutionMiddleware` (§3) резолвит по `custom_domain`
ТОЛЬКО когда `custom_domain_status = 'verified'` — уточнение к `SRS-API-041` шаг 1, не противоречие
(документ описывал алгоритм резолвинга по факту совпадения строки, это дополнение сужает условие
проверенным доменом).

**4. Новая таблица `whitelabel_contracts` (владелец домена — модуль `billing`, не `tenancy`;
приведена здесь, т.к. обнаружена как пробел при анализе White-Label в этом модуле, REQ-MON-10).**

```sql
CREATE TYPE whitelabel_contract_status AS ENUM ('draft', 'active', 'suspended', 'terminated');

CREATE TABLE whitelabel_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id UUID NOT NULL UNIQUE REFERENCES pharmacy_chains(id) ON DELETE RESTRICT,
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL, -- заполняется после провизионинга (SRS-TEN-020)
    status whitelabel_contract_status NOT NULL DEFAULT 'draft',
    setup_fee_diram BIGINT NOT NULL,
    monthly_fee_diram BIGINT NOT NULL,
    monthly_fee_per_pharmacies_block INT NOT NULL DEFAULT 10, -- "3-4 тыс. TJS/10 точек"
    royalty_bps SMALLINT, -- NULL = без роялти; 100-200 = 1-2% (ASSUMPTION research §16)
    signed_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_whitelabel_contracts_fees_nonneg CHECK (setup_fee_diram >= 0 AND monthly_fee_diram >= 0)
);
COMMENT ON TABLE whitelabel_contracts IS
    'Коммерческие условия White-Label (REQ-MON-10), ASSUMPTION-ставки research §16 (setup '
    '15-40 тыс TJS, monthly 3-4 тыс/10 точек, роялти 1-2% GMV) — подлежат утверждению '
    'продуктом/финансами до первого реального контракта (R3). Доступ — только tenancy:'
    'manage-commission-rates-эквивалент финансовой роли, НЕ pharmacy_admin.';
```
Обоснование: `REQ-MON-10` явно требует эту таблицу («хранятся отдельно от `tenant_settings`,
доступны только ролям с финансовыми правами»), `11-database-schema.md` её не содержит — пробел,
architect ruling D-03/§Часть C не перечисляет её явно среди 14 обязательных дополнений, но
`REQ-MON-10` (Must) требует. Полная спецификация состояний/переходов и биллинг-джобы,
формирующей `platform_billing_invoices` из этого контракта, — предмет отдельного SRS-документа
модуля `billing` (не дублируется здесь, только форма таблицы для устранения блокирующего пробела
схемы).

---

## 13. Пограничные случаи и ошибки

**SRS-TEN-035** Домен тенанта отозван (сеть прекратила White-Label подписку, `super_admin` вручную
очищает `tenants.custom_domain = NULL, custom_domain_status = 'none'`) — DNS клиента при этом ещё
может указывать на инфраструктуру DoruTJ (клиент не убрал свою A/CNAME-запись). Given запрос приходит
на этот «осиротевший» `Host`, When `TenantResolutionMiddleware` шаг 1 не находит совпадения (строка
`custom_domain` уже пуста), Then шаг 2/3 срабатывает как обычно → пользователь видит НЕЙТРАЛЬНЫЙ
публичный DoruTJ на брендированном домене сети (не ошибку, не 5xx) — уже специфицировано
`SRS-API-073` родительского документа, здесь подтверждается: это ожидаемое, не новое поведение.

**SRS-TEN-036** Тенант деактивирован (`pharmacy_chains.status = 'suspended'/'terminated'`, тенант
остаётся физически в БД). Given резолвинг тенанта успешен (Host/slug совпал), When
`TenantResolutionGuard` пропускает запрос ДАЛЬШЕ (резолвинг — не проверка активности), Then отдельная
проверка в `application`-политиках конкретных use case (`OrdersFacade.isPharmacyActive`, уже
`SRS-DOM-012`) отклоняет операционные действия — САМ факт «тенант существует, но неактивен» не
блокируется на уровне резолвинга (иначе `pharmacy_admin` этой сети не смог бы даже зайти в
собственный кабинет посмотреть причину приостановки) — код `403 TENANT_SUSPENDED` применяется ТОЛЬКО
к клиентским (не операционным для персонала сети) действиям — точный список эндпоинтов, где
`TENANT_SUSPENDED` возвращается вместо `PHARMACY_SUSPENDED`, — каталог/checkout для конечного
покупателя (клиент не видит и не заказывает в приостановленной сети), административные
эндпоинты сети остаются доступны её `pharmacy_admin` (просмотр причины, обжалование).

**SRS-TEN-037** Попытка кросс-тенантного запроса (украден/скопирован JWT). Уже полностью
специфицировано `SRS-API-045/046` (403 `CROSS_TENANT_ACCESS_DENIED` на уровне guard'а до контроллера,
404 при попытке доступа к чужому ресурсу по ID) — этот модуль ДОБАВЛЯЕТ: событие
`CrossTenantAccessAttemptedEvent` публикуется в `outbox` (для `analytics`/security-мониторинга) при
КАЖДОМ срабатывании `SRS-API-045`, отдельно от штатного `audit_log` (это попытка нарушения, не
легитимное действие `super_admin`, не должно засорять пользовательский `audit_log`, но должно быть
видно оператору безопасности как сигнал — накопление таких событий с одного `userId`/IP за короткое
окно — кандидат на алерт, конкретный порог алертинга — эксплуатационная настройка, не предмет этого
SRS).

**SRS-TEN-038** Тенант без настроенного брендинга (только что провизионирован, чек-лист §6 не пройден
дальше шага 2). Given `tenant_settings.brand_palette = '{}'::jsonb` (дефолт), When
`GET /tenant/branding`, Then возвращается СЕРАЯ нейтральная палитра (та же, что build-time fallback
фронта, SRS-TEN-015) — НЕ ошибка, НЕ палитра нейтрального нейтрального нейтрального тенанта
DoruTJ по умолчанию (чужой бренд не должен «просвечивать» для тенанта, который просто ещё не
настроил свой — это выглядело бы как баг «сайт открылся под чужим брендом»). `brand_name`, однако,
`NOT NULL` без дефолта в БД (§12 показывает как есть) — `ProvisionTenantUseCase` (SRS-TEN-020)
обязан передать `initialBrandName` (например, `legal_entity_name` сети как временную заглушку) —
никогда пустую строку.

**SRS-TEN-039** Конфликт `custom_domain` (два тенанта пытаются привязать один домен — опечатка
оператора либо намеренная атака). Given домен уже привязан (verified ИЛИ pending) к тенанту A, When
`AttachCustomDomainUseCase` вызывается для тенанта B с тем же `domain`, Then `409 DOMAIN_TAKEN`
(доменная ошибка `DuplicateCustomDomainError`, уже в каталоге ошибок родительского документа,
`SRS-DOM-044`) — проверка на уровне `UNIQUE(custom_domain)` (уже в схеме) ловит это как последний
рубеж, но `application`-слой обязан проверить ЗАРАНЕЕ (дружелюбная ошибка вместо голого
`23505 unique_violation`, транслируемого в `500`, если бы проверки не было).

**SRS-TEN-040** Гонка: два административных запроса одновременно меняют `brand_palette` одного
тенанта (два открытых таба `apps/admin`). Given оба запроса проходят валидацию (SRS-TEN-014)
независимо, When оба `PUT /branding` почти одновременно, Then последний committed `UPDATE`
побеждает (`updated_at` перезаписывается, `optimistic concurrency` НЕ применяется для этого
конкретного ресурса — брендинг не финансовая операция, потеря одной из двух правок при
одновременном редактировании двумя вкладками ОДНОГО администратора — приемлемый UX-компромисс,
не требующий версионирования; в отличие от `escrow_ledger`, где гонка недопустима категорически).

**SRS-TEN-041** `SecretsVaultPort.resolve()` недоступен (Vault-сервис не отвечает) в момент
чекаута White-Label заказа. Given `merchant_credentials_status='configured'`, но реальный секрет
временно не читается, When `PaymentsFacade.createInvoice`, Then `503 PAYMENT_PROVIDER_UNAVAILABLE`
(тот же код, что недоступность самого банковского провайдера, `ExternalIntegrationError` семейство
родительского каталога — с точки зрения клиента разница между «Vault упал» и «банк упал»
несущественна, оба — временная невозможность оплаты картой/QR, `cash_courier` остаётся доступен).

---

## 14. Тестовые сценарии

| TC | Проверяет | Given | When | Then |
|---|---|---|---|---|
| TC-TEN-001 | SRS-TEN-001 | `tenants` содержит одну `is_neutral=true` строку | Попытка `INSERT tenants(is_neutral=true, ...)` второй раз | `23505 unique_violation` (`ux_tenants_single_neutral`) |
| TC-TEN-002 | SRS-TEN-002 (доп. §12 п.1) | Тенант уже существует для `chain_id=X` | `ProvisionTenantUseCase.execute({chainId: X, ...})` повторно | `409`, доменная ошибка «тенант уже существует для сети», `ux_tenants_single_chain` как рубеж БД |
| TC-TEN-003 | SRS-TEN-005/006 | Redis недоступен (симулирован обрыв соединения) | Запрос с известным `Host` | Тенант резолвлен через прямой запрос к Postgres, `pino.warn` записан, ответ клиенту не деградирует |
| TC-TEN-004 | SRS-TEN-007 | Dev-окружение, заголовок `X-Tenant-Slug: sifat-demo` | `GET /api/v1/catalog/search` | Возвращены только данные тенанта `sifat-demo` (аптеки/цены), не `neutral` |
| TC-TEN-005 | SRS-TEN-009/011 | Репозиторий `OrdersRepository.findById` | Вызов БЕЗ параметра `tenantId` | Ошибка компиляции TypeScript (метод требует параметр), тест `tenant-isolation.contract-test.ts` фиксирует сигнатуру |
| TC-TEN-006 | SRS-TEN-012, Charter §3.4 (обязательный) | Заказ создан для тенанта A (`OrdersFacade`, минуя HTTP) | `OrdersFacade.getOrder({tenantId: B, orderId})` | `null`/`NotFoundError`, без похода в HTTP-слой |
| TC-TEN-007 | SRS-TEN-010 | Общий `medicine_id` используется тенантами A и B | `moderation` обновляет `description_ru` | Оба тенанта видят новое описание немедленно (не утечка — намеренно общий справочник) |
| TC-TEN-008 | SRS-TEN-014 | `PUT /admin/tenants/:id/branding` с `--brand-primary: "url(javascript:alert(1))"` | Запрос | `400 VALIDATION_ERROR`, `details.field='--brand-primary'`, значение НЕ сохранено |
| TC-TEN-009 | SRS-TEN-014 | `--brand-font-family: "MyCustomHackerFont, sans-serif"` (вне allowlist) | `PUT /branding` | `400 VALIDATION_ERROR` |
| TC-TEN-010 | SRS-TEN-015 | `tenant_settings.brand_palette` заполнена для тенанта X | Первая загрузка `apps/web` на домене тенанта X (холодный кэш браузера) | До ответа `/tenant/branding` видна нейтральная серая палитра; после — палитра тенанта X, без перезагрузки страницы |
| TC-TEN-011 | SRS-TEN-017 | Демо-тенант, `BRAND_NAME` изменён с `"DemoChain"` на `"NewBrandXYZ"` через `PUT /branding` | Полный Playwright-прогон customer+admin UI этого тенанта | Строка `"DemoChain"` не встречается нигде в DOM |
| TC-TEN-012 | SRS-TEN-020 | `pharmacy_chains.status='pending_review'` (ещё не `approved`) | `ProvisionTenantUseCase.execute(...)` | Отклонено, доменная ошибка (аналог `ParentChainNotActiveError`), тенант не создан |
| TC-TEN-013 | SRS-TEN-020 | `slug='admin'` (зарезервированное значение) | `ProvisionTenantUseCase.execute({slug: 'admin', ...})` | `ReservedTenantSlugError` → `400` |
| TC-TEN-014 | SRS-TEN-021 | `POST /admin/tenants` без заголовка `Idempotency-Key` | Запрос | `400 IDEMPOTENCY_KEY_REQUIRED` |
| TC-TEN-015 | SRS-TEN-022/023 | `merchant_credentials_ref` разрешается в `{merchantId, apiKey}` | Структурный лог вызова `PaymentsFacade.createInvoice` | `apiKey` отсутствует в записи лога (redaction сработала) |
| TC-TEN-016 | SRS-TEN-025 | Тенант без `merchant_credentials_ref`, заказ `payment_method='alif_mobi'` | `POST /orders` (checkout) | `503 SERVICE_UNAVAILABLE`, `details.reason='tenant_payment_not_configured'` |
| TC-TEN-017 | SRS-TEN-025 | Тот же тенант, `payment_method='cash_courier'` | `POST /orders` | Заказ создаётся успешно (наличные не блокируются отсутствием банковских кредов) |
| TC-TEN-018 | SRS-TEN-026/027 | Webhook Telegram на путь тенанта A с `secret_token` тенанта B | `POST /webhooks/telegram/tenant-a-slug` | `401`, апдейт не обработан, не создаётся никаких сущностей |
| TC-TEN-019 | SRS-TEN-028 | Тенант A рассылает 1000 уведомлений одновременно | Тенант B отправляет 1 уведомление в это же окно | Уведомление тенанта B доставлено без задержки от очереди тенанта A (разные `rateLimiterKey`) |
| TC-TEN-020 | SRS-TEN-029 | Тенант без `telegram_bot_token_ref`, у пользователя есть `phone` | `NotificationsFacade.send(userId, event)` | Канал `telegram` пропущен, `sms`/`web_push` использован как фоллбэк, ошибки пользователю нет |
| TC-TEN-021 | §12 п.3, custom_domain_status | `custom_domain='sifat.tj'`, `custom_domain_status='pending_verification'` (DNS TXT ещё не проверен) | Запрос с `Host: sifat.tj` | Тенант НЕ резолвится по этому домену (шаг 1 пропущен, статус не `verified`), фолбэк на `X-Tenant-Slug`/`neutral` |
| TC-TEN-022 | SRS-TEN-039 | Домен `pharmacy.example.tj` уже `verified` у тенанта A | `AttachCustomDomainUseCase` для тенанта B с тем же доменом | `409 DOMAIN_TAKEN` |
| TC-TEN-023 | SRS-TEN-035 | `tenants.custom_domain=NULL` (тенант отвязан), внешний DNS ещё указывает на DoruTJ | Запрос с этим устаревшим `Host` | Показан нейтральный публичный DoruTJ, НЕ ошибка, `pino.warn(domain_resolution_fallback)` записан |
| TC-TEN-024 | SRS-TEN-036 | `pharmacy_chains.status='suspended'` | `GET /admin/tenants/:id/settings` от `pharmacy_admin` этой же сети | Доступ разрешён (просмотр причины приостановки не блокируется) |
| TC-TEN-025 | SRS-TEN-036 | Та же приостановленная сеть | Анонимный покупатель открывает её каталог/пытается оформить заказ | `403 TENANT_SUSPENDED`, каталог не показывает товары этой сети |
| TC-TEN-026 | SRS-TEN-037 | `super_admin` не задействован, обычный `customer` тенанта A обращается по домену тенанта B | Запрос | `403 CROSS_TENANT_ACCESS_DENIED` + запись `CrossTenantAccessAttemptedEvent` в `outbox` |
| TC-TEN-027 | SRS-TEN-041 | `SecretsVaultPort.resolve()` бросает таймаут (симулировано в тесте) | `PaymentsFacade.createInvoice` для White-Label заказа | `503 PAYMENT_PROVIDER_UNAVAILABLE`, `cash_courier`-заказ в это же время создаётся успешно |
| TC-TEN-028 | SRS-TEN-033 п.2 | `OFFLINE_MODE=true` (on-premise профиль) | Старт `apps/api`/`apps/web` без доступа в интернет | Приложение поднимается полностью, шрифты рендерятся локально, нет исходящих запросов к `fonts.googleapis.com` (проверяется network-логом контейнера) |
| TC-TEN-029 | SRS-TEN-033 п.2 | `LICENSE_KEY` с `expiresAt` в прошлом | Проверка `LicenseVerificationGuard` при периодическом чеке | `GET /ready` возвращает `503`, уже открытые пользовательские сессии продолжают обслуживаться |
| TC-TEN-030 | SRS-TEN-038 | Только что провизионированный тенант, `brand_palette='{}'` | `GET /tenant/branding` | Возвращена нейтральная серая палитра (не палитра `neutral`-тенанта DoruTJ, не ошибка) |

---

**Итог**: документ вводит 41 требование `SRS-TEN-000..041` (модель тенанта и провизионинг, кэшируемый
алгоритм резолвинга с локальной multi-tenant разработкой, классификацию изоляции данных по 4 типам
скоупа с обязательным контракт-тестом на утечку, полный каталог токенов брендинга с allowlist-защитой
от CSS/HTML-инъекции и рантайм-применением без пересборки, 48-часовой чек-лист запуска с обоснованием
единственного внеконтрольного шага (DNS), хранение платёжных и Telegram-кредов через
`SecretsVaultPort` (порт+Mock, R1 / реальный Vault, R3), мультибот-роутинг по пути запроса,
per-tenant тарифы и обнаруженный пробел схемы `whitelabel_contracts`, чек-лист on-premise поставки) и
30 тестовых сценариев `TC-TEN-001..030`, обязательных для тикетов Tech Lead модуля `tenancy` и для
guard'ов/репозиториев ВСЕХ остальных модулей, ссылающихся на тенант-скоуп. Каждое требование помечено
меткой релиза (`[R1]`/`[R2]`/`[R3]`) согласно `04-SCOPE-DECISION-PIVOT.md` — по принципу «архитектура
целиком сейчас, активация конкретного White-Label клиента — при снятии внешнего блокера». Любое
расхождение с `10-domain-model.md`/`11-database-schema.md`/`12-api-conventions-auth-tenancy.md`
разрешается только через ADR.
