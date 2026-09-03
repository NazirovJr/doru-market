# DoruTJ — Модуль CATALOG + SEARCH: Каталог, умный поиск и подбор аналогов по МНН

> Владелец: Analyst (SRS). Статус: **BASELINE для фазы Analysis**.
> Приоритет источников при противоречии: `04-SCOPE-DECISION-PIVOT.md` > `03-ARCHITECT-DECISIONS.md` (D-*)
> > `00-PROJECT-CHARTER.md` (CUJ-*, §) > `research/00-RESEARCH-DIGEST.md` (REQ-*) > `tz.log` (§ТЗ).
> Документы `10-domain-model.md`, `11-database-schema.md`, `12-api-conventions-auth-tenancy.md` —
> **ЗАКОН**: сущности, поля, enum'ы, коды ошибок и SRS-DOM-*/SRS-DB-*/SRS-API-* требования из них
> НЕ переопределяются, только цитируются. Всё, чего не хватает в схеме, вынесено в
> раздел «Дополнения к схеме БД» с явным обоснованием.
>
> Слои — по `02-CLEAN-ARCHITECTURE-AND-CODE.md`: **domain** (`modules/catalog/domain/*`,
> `modules/inventory/domain/*` — уже определены в `10-domain-model.md`), **application**
> (`modules/catalog/application/*` — use cases, порты), **infrastructure**
> (`modules/catalog/infrastructure/*` — Drizzle-репозитории, `PostgresSearchProvider`,
> `ElasticSearchProvider`, кэш), **presentation** (`modules/catalog/presentation/*` — контроллеры).
>
> Идентификаторы требований этого документа: **SRS-CAT-nnn**. Тестовые сценарии: **TC-CAT-nnn**.
> Каждое требование помечено меткой релиза **[R1]** / **[R2]** / **[R3]** (`04-SCOPE-DECISION-PIVOT.md`).
> Покрывает: **CUJ-1** (`00-PROJECT-CHARTER.md` §6), **МОДУЛЬ 1** (`tz.log`), **R1-1/R1-2/R1-3/R1-4/R1-6**
> (`04-SCOPE-DECISION-PIVOT.md` §3.1).

---

## Разбиение по релизам

> Обязательный раздел по решению владельца продукта (`04-SCOPE-DECISION-PIVOT.md`, приоритет выше
> устава). Позиционирование изменено: главный экран — **поиск со сравнением цены и показом
> экономии**, не каталог-для-доставки. Ключевая метрика — **сэкономленные сомони**, не число заказов.

| Возможность модуля | Релиз | Почему |
|---|---|---|
| Модель каталога: `medicines`/`substances`/`medicine_substances`/`categories`, seed ≥300 позиций | **R1** | Ядро продукта (R1-2); без каталога не работает ни поиск, ни аналоги |
| `SearchProvider` — порт (интерфейс) | **R1** | Архитектурное основание закладывается сразу целиком (§2.2 `04-SCOPE-DECISION-PIVOT.md`) — ретрофит порта дороже, чем спроектировать его с первого дня, даже если конкретный адаптер меняется позже |
| `PostgresSearchProvider` — рабочий адаптер | **R1** | Единственный обязательный движок поиска на объём ≥300–10k SKU (Charter ADR №1); R1-3 |
| Алгоритм ранжирования (релевантность+наличие+гео+цена+рейтинг) | **R1** | Прямая реализация позиционирования «дешевле рядом», ядро CUJ-1 |
| Опечатки/тадж. кириллица/транслит/штрихкод/МНН/производитель | **R1** | R1-3, явно перечислено в `04-SCOPE-DECISION-PIVOT.md` |
| Автодополнение | **R1** | Часть R1-3, UX-обязательность (REQ-UX-12) |
| Движок аналогов по МНН + расчёт экономии + дисклеймеры | **R1** | **R1-1 — единственное признанное защитимое отличие продукта** (`04-SCOPE-DECISION-PIVOT.md` §2) |
| Мультиаптечные цены/остатки в карточке, `last_synced_at`, пометка устаревания | **R1** | R1-4 — второе защитимое отличие |
| Карта аптек (MapLibre/OSM, self-hosted тайлы) | **R1** | R1-6, явно перечислено; REQ-GEO-1 запрещает Yandex Maps |
| Фильтры: гео-радиус, «в наличии», «открыто сейчас», «24/7» | **R1** | Часть R1-6/CUJ-1 |
| `ElasticSearchProvider` — опциональный адаптер за тем же портом | **R2** | Не заблокирован внешней зависимостью, но и не обслуживает текущий объём (~300–неск. тыс. SKU, D-13) — порт уже спроектирован под замену одной ENV (`SEARCH_DRIVER`), реализация откладывается до фактического роста каталога за пределы комфортной зоны PostgreSQL FTS |
| AI-сопоставление изображений/OCR-подсказки в каталоге | **R2** | Часть «AI-конвейера рецептов» (Модуль 2 — отдельный документ), не Modul 1 |
| Персонализированное ранжирование (история покупок конкретного пользователя) | **R3** | Обслуживает неподтверждённый спрос на персонализацию, не входит в узкий объём R1 (`04-SCOPE-DECISION-PIVOT.md` §6) |
| White-Label кастомизация витрины каталога (свой брендинг результатов поиска для сети) | **R3** | Заблокирован отсутствием подписанного LOI/пилота сети (`04-SCOPE-DECISION-PIVOT.md` §5) — сама архитектура (tenant-скоуп поиска) уже в R1 |

**SRS-CAT-001** [`04-SCOPE-DECISION-PIVOT.md` §2.1, R1-1] **[R1]** Главный экран Customer Web
(`apps/web`, `pages/home`) — строка поиска с плейсхолдером `search.placeholder` (i18n-ключ, дефолт
`tj`) и, при наличии геолокации, лентой «дешевле рядом» (топ-N товаров с наибольшей относительной
экономией в радиусе пользователя); НЕ карта доставки, НЕ баннер «сделать заказ» — это единственный
приоритетный порядок вёрстки первого экрана, проверяемый визуальным regression-тестом Playwright.

---

## Область действия документа

Специфицирует контекст **catalog** (`modules/catalog`) целиком и потребление контекста **inventory**
(`modules/inventory`, уже определён `10-domain-model.md`) через `InventoryFacade`/прямые read-only
SQL-джойны в `PostgresSearchProvider` (обоснование layering — §2.2). Не специфицирует: онбординг
аптек (`onboarding`, отдельный документ), приём 1С/Excel-выгрузок как таковой (`inventory` ingestion,
отдельный документ — здесь используется только как источник данных для поиска), корзину/чекаут
(`orders`), OCR/голосовой ввод (Модуль 2/`prescriptions`).

---

## 1. Модель каталога

### 1.1 Дерево категорий

Таблица `categories` (`11-database-schema.md` §«Группа A», строки 321-334) — уже определена,
переопределению не подлежит. Ключевые моменты для реализации:

**SRS-CAT-002** [`11-database-schema.md` DDL `categories`] **[R1]** Дерево — self-reference
`parent_id`, без ограничения глубины на уровне БД; `application`-валидатор
(`CategoryTreeService.validateDepth()`, domain-сервис контекста `catalog`) ограничивает глубину
`CATEGORY_MAX_DEPTH = 3` (ASSUMPTION, конфигурируемо) — глубже 3 уровней навигация становится
непригодной для мобильного экрана (Charter §7 «мобильный трафик первичен»).

**SRS-CAT-003** **[R1]** `commission_category` (`'rx'|'otc'|'parapharma'`) — НЕ дерево навигации,
отдельная грубая группировка для `platform_fee` (D-03, SRS-DOM-160 из `11-database-schema.md`).
Категория навигации (`categories.id`) и `commission_category` независимы: одна категория навигации
(«Обезболивающие») может содержать и `otc`-, и `rx`-товары одновременно — комиссия резолвится по
`commission_category` конкретного `medicine.category_id → categories.commission_category`, не по
пути навигации.

**SRS-CAT-004** [Charter §5 i18n] **[R1]** `GET /api/v1/categories` возвращает дерево целиком
(≤200 узлов ожидаемо, без пагинации) с полями `{ id, parentId, slug, name: {tj,ru,en}, sortOrder,
childrenCount }`; ответ кэшируется (§11) — категории меняются редко (только через `apps/admin`).

### 1.2 Медикаменты и действующие вещества

Таблицы `medicines`, `substances`, `medicine_substances` (`11-database-schema.md` строки 339-410) и
агрегат `Medicine` (`10-domain-model.md` SRS-DOM-013..017) — уже определены. Ниже — только
уточнения уровня API/каталога, не переопределение полей.

**SRS-CAT-005** [SRS-DOM-013] **[R1]** `GET /api/v1/medicines/:id` возвращает `medicine.publish()`-
опубликованные записи (`is_published = true`) для анонимного/customer-доступа; черновики
(`is_published = false`, ожидающие модерации в `catalog_match_queue`) видны только
`super_admin`/оператору каталога через `apps/admin` (не через публичный эндпоинт — `404 NOT_FOUND`
для остальных ролей, не `403`, т.к. черновик не обязан быть виден как «запрещённый ресурс»).

**SRS-CAT-006** [D-08, SRS-DOM-157] **[R1]** `medicine.controlCategory ∈ {psychotropic, narcotic}`
исключается из ЛЮБОГО ответа каталога/поиска — включая прямой `GET /medicines/:id` по известному
`id`. Given клиент запрашивает такую запись напрямую по UUID, When обработка, Then `404 NOT_FOUND`
(не `422 CONTROLLED_SUBSTANCE_FORBIDDEN` — существование конкретной запрещённой к обороту записи не
подтверждается посторонним, тот же принцип, что и для кросс-тенантных 404, SRS-API-046).

### 1.3 Изображения и описания tj/ru

**SRS-CAT-007** [`medicines.image_url`, `description_tj`, `description_ru`] **[R1]** MVP-каталог
использует ОДНО обложечное изображение на медикамент (`image_url`, схема `11-database-schema.md`
не расширяется галереей — намеренно, чтобы не плодить незаполняемое сеидом поле: курируемый
seed ≥300 позиций, D-13, не гарантирует фото под каждый ракурс). Отсутствующее `image_url` рендерится
плейсхолдером по `dosage_form_class` (9 SVG-иконок форм выпуска — таблетка/капсула/сироп/..., пакет
`packages/ui`), НЕ пустым `<img>` без `alt`.

**SRS-CAT-008** [Charter §5 i18n] **[R1]** Описание отображается по правилу фолбэка:
`locale='tj'` → `description_tj`, если пусто → `description_ru`, если и это пусто → блок описания не
рендерится (не «Описание отсутствует» как заглушка — пустое поле не есть ошибка). `description_en`
НЕ существует в схеме намеренно (только `tj`/`ru` — `en` в продукте используется для UI-строк
интерфейса, не для медицинских описаний, которых нет в источниках данных аптек).

**SRS-CAT-009** **[R1]** `trade_name`/`inn_name` — ЕДИНСТВЕННЫЕ поля названия, без отдельных
tj/ru/en вариантов (латиница МНН и торговое название международны по конвенции ВОЗ, tz.log). Слова
интерфейса вокруг названия (`«Состав»`, `«Форма выпуска»`) — через `useT()`, не хардкод.

### 1.4 Дерево видимости: публикация × активность аптеки/сети

**SRS-CAT-010** [SRS-DOM-131 `onboarding→inventory` из `10-domain-model.md`, REQ-ONBOARD-15] **[R1]**
Медикамент видим в результатах поиска ТОЛЬКО если одновременно: (1) `medicines.is_published = true`;
(2) существует ≥1 строка `pharmacy_inventory` с `stock_quantity >= 0` у аптеки со `status = 'active'`
(строка условия наличия зависит от фильтра «только в наличии», §7); (3) `pharmacy_chains.status IN
('approved','active')` для родительской сети этой аптеки. Условие (3) проверяется JOIN'ом на
`pharmacy_chains` внутри `PostgresSearchProvider`, не отдельным вызовом `OnboardingFacade` (§2.2 —
обоснование прямого JOIN в read-модели поиска).

---

## 2. SearchProvider — порт и адаптеры

### 2.1 Порт (application layer)

**SRS-CAT-011** [Charter §3.3 Provider Pattern, `02` §1.3] **[R1]** Порт объявляется в
`modules/catalog/application/ports/search-provider.port.ts`:

```typescript
export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER');

export interface SearchQuery {
  readonly tenantId: TenantId;
  readonly text: string;                 // '' допустима — режим «браузинг по фильтрам», §7
  readonly locale: 'tj' | 'ru' | 'en';
  readonly geo?: GeoPoint;
  readonly radiusMeters?: number;        // 1000..20000, дефолт SEARCH_DEFAULT_RADIUS_METERS=5000
  readonly filters: SearchFilters;
  readonly sort: 'relevance' | 'price_asc' | 'price_desc' | 'distance_asc';
  readonly cursor?: string;
  readonly limit: number;                // 1..100, дефолт 20 (SRS-API-004)
}

export interface SearchFilters {
  readonly categoryId?: number;
  readonly inStockOnly: boolean;         // дефолт false, §7.2
  readonly openNowOnly: boolean;         // дефолт false, §7.3
  readonly is24x7Only: boolean;          // дефолт false, §7.3
  readonly priceMinDiram?: number;
  readonly priceMaxDiram?: number;
  readonly manufacturerName?: string;
  readonly isPrescriptionRequired?: boolean;
}

export interface SearchResultItem {
  readonly medicineId: string;
  readonly tradeName: string;
  readonly innName: string;
  readonly dosageForm: string;
  readonly dosageStrength: string;
  readonly imageUrl: string | null;
  readonly isPrescriptionRequired: boolean;
  readonly cheapestOffer: PharmacyOffer | null;   // null = ни одной активной аптеки не несёт товар
  readonly offersCountInRadius: number;
  readonly relevanceScore: number;                // 0..1, для отладки/аналитики, не для UI
}

export interface PharmacyOffer {
  readonly pharmacyId: string;
  readonly pharmacyName: string;
  readonly priceDiram: number;
  readonly stockQuantity: number;
  readonly distanceMeters: number | null;          // null если geo не передан
  readonly lastSyncedAt: string;                   // ISO 8601 UTC
  readonly isStale: boolean;                        // now - lastSyncedAt > INVENTORY_DELTA_SLA_MINUTES*3 (§7.5)
}

export interface SearchResultPage {
  readonly items: readonly SearchResultItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface SuggestItem {
  readonly medicineId: string;    // канонический представитель дедуп-группы, §5
  readonly tradeName: string;
  readonly innName: string;
  readonly matchedVia: 'prefix' | 'trigram' | 'inn';
}

export interface SearchProvider {
  search(query: SearchQuery): Promise<SearchResultPage>;
  suggest(prefix: string, tenantId: TenantId, limit: number): Promise<readonly SuggestItem[]>;
}
```

**SRS-CAT-012** [`02` §1.3] **[R1]** `SearchProvider` выбирается через `{ provide: SEARCH_PROVIDER,
useClass: ... }` в `catalog.module.ts` по ENV `SEARCH_DRIVER` (`postgres` дефолт | `elasticsearch`).
Use case `SearchMedicinesUseCase`/`SuggestMedicinesUseCase` (application) получает порт через
конструктор — ни один use case не импортирует `PostgresSearchProvider` напрямую (`new` инфраструктуры
внутри application запрещён, `02` §1.3).

### 2.2 PostgresSearchProvider — адаптер (infrastructure, R1 основной)

**SRS-CAT-013** [Charter ADR №1, `11-database-schema.md` §«Полнотекстовый поиск»] **[R1]**
`modules/catalog/infrastructure/adapters/postgres-search.adapter.ts` реализует `SearchProvider`,
выполняя SQL, опирающийся на `search_vector`/`pg_trgm`/`tajik_ru`-конфигурацию, уже определённые в
`11-database-schema.md` (запросы 1–4 того документа воспроизведены и расширены здесь до полного
ранжирования, §3).

**SRS-CAT-014** [`02` §1.1, обоснование исключения] **[R1]** `PostgresSearchProvider` — ЕДИНСТВЕННОЕ
место в кодовой базе, которому разрешено выполнять `JOIN` через таблицы, физически принадлежащие
чужим bounded contexts (`pharmacy_inventory`/`inventory_batches` — `inventory`; `pharmacies`/
`pharmacy_chains` — `onboarding`) НАПРЯМУЮ в SQL, а не через вызов чужого `Facade`. Обоснование:
поиск/ранжирование — по определению read-модель, агрегирующая данные нескольких агрегатов ради
одного оптимизированного запроса (тот же принцип, что и `analytics`, `10-domain-model.md`
«Ограниченные контексты» — «read-модель, не оркестрация доменных инвариантов»); JOIN здесь не
записывает данные и не воспроизводит бизнес-инвариант чужого агрегата, а лишь читает уже
консистентное состояние. Правило `dependency-cruiser` (`02` §6) для этого файла имеет явное
исключение (`allowed: true` для `postgres-search.adapter.ts` → `db/schema/*`), задокументированное
комментарием с ссылкой на этот пункт — исключение НЕ распространяется ни на один другой файл модуля
`catalog`.

**SRS-CAT-015** [SRS-DB-017/018] **[R1]** Провайдер устанавливает `SET pg_trgm.similarity_threshold
= 0.20` на соединении сессии ПЕРЕД выполнением поискового запроса (через `pool` hook
`infrastructure`, не глобальный `postgresql.conf`) — тот же порог, что и `11-database-schema.md`
SRS-DB-017, не переопределяется отдельным значением здесь.

### 2.3 ElasticSearchProvider — адаптер (опциональный, R2)

**SRS-CAT-016** [Charter §3.5 №1] **[R2]** Реализует тот же интерфейс `SearchProvider`, посылая
запрос в Elasticsearch (индекс `medicines_{tenant_slug}` или единый индекс с полем `tenant_id`,
решение — на момент реализации R2). Схема данных PostgreSQL НЕ меняется при включении этого
адаптера — Elasticsearch синхронизируется отдельным консьюмером `outbox` (`MedicinePublishedEvent`/
`InventorySyncBatchCompletedEvent`, уже существующие в `10-domain-model.md` доменные события,
переиспользуются как триггер переиндексации). Переключение — одна ENV `SEARCH_DRIVER=elasticsearch`,
без изменения кода `SearchMedicinesUseCase`.

**SRS-CAT-017** **[R2]** До реализации адаптера в R1 достаточно, чтобы `SearchProvider` порт
компилировался с ОДНИМ реальным адаптером (`PostgresSearchProvider`) и НЕ содержал условной логики
«если Elasticsearch» нигде вне `catalog.module.ts` — интерфейс спроектирован полным (§2.1) именно
для того, чтобы адаптер R2 добавлялся без изменения контракта (Charter «Provider Pattern»).

---

## 3. Алгоритм ранжирования результатов поиска

> Формула ниже применяется ТОЛЬКО к уровню «список медикаментов по текстовому/фильтровому запросу»
> (`SearchProvider.search()`). Список аналогов по МНН (§6) сортируется СТРОГО по цене возрастания
> (SRS-DOM-158/159 — обязательное правило домена, никакая композитная формула его не переопределяет:
> плашка экономии обязана показывать РЕАЛЬНО самый дешёвый вариант, не «рекомендованный»).

### 3.1 Компоненты формулы

**SRS-CAT-018** [REQ-MARKET-3, tz.log Модуль 1 «список аптек, отсортированный по...»] **[R1]**
Итоговый `relevanceScore` медикамента для конкретного запроса — взвешенная сумма пяти компонент,
каждая нормализована в `[0, 1]`:

```
finalScore = 0.40 × textRelevance
           + 0.20 × availabilityScore
           + 0.15 × proximityScore
           + 0.15 × priceScore
           + 0.10 × reliabilityScore
```

| Компонента | Вес | Формула | Источник данных |
|---|---|---|---|
| `textRelevance` | 0.40 | См. §3.2 | `medicines.search_vector`, `pg_trgm` |
| `availabilityScore` | 0.20 | `min(offersCountInRadius / AVAILABILITY_SATURATION_OFFERS, 1.0)`, `AVAILABILITY_SATURATION_OFFERS = 3` (ASSUMPTION) | `pharmacy_inventory` в радиусе |
| `proximityScore` | 0.15 | `1 - min(nearestOfferDistanceMeters / radiusMeters, 1.0)`; при отсутствии `geo` — компонента исключается, веса перенормируются (§3.4) | `ST_Distance` до ближайшей аптеки с товаром |
| `priceScore` | 0.15 | Min-max внутри ТЕКУЩЕГО набора результатов страницы: `1 - (cheapestOfferPriceDiram − minPriceInPage) / (maxPriceInPage − minPriceInPage)`; при `maxPriceInPage = minPriceInPage` → `1.0` для всех | `pharmacy_inventory.price_tjs` (сконвертировано в diram, `10-domain-model.md` Money-конвенция) |
| `reliabilityScore` | 0.10 | `pharmacyReliabilityScore(cheapestOfferPharmacyId) / 5.0` (§14.1, новая проекция) | `pharmacy_reliability_scores` (доп. схема, §14) |

**SRS-CAT-019 — Нормализация `textRelevance`** [SRS-DB-013..017] **[R1]** Определяется тремя
уровнями (не сырым `ts_rank`, значение которого не ограничено сверху и непереносимо между запросами):

1. Given найдено полнотекстовое совпадение (`search_vector @@ plainto_tsquery('tajik_ru', :q)`) на
   поле веса `A` (`trade_name`/`inn_name`), Then `textRelevance = 1.0`.
2. Given совпадение только на поле веса `C` (`manufacturer_name`), Then `textRelevance = 0.7`.
3. Given только триграммное совпадение (`trade_name % :q` без `tsvector`-хита), Then
   `textRelevance = clamp((similarity(trade_name, :q) − 0.20) / 0.80, 0, 1)` — линейная
   растяжка диапазона `[порог 0.20 .. 1.0]` в `[0, 1]`.
4. Given оба типа совпадения (частая ситуация — точное слово ЕЩЁ и похоже триграммно), Then
   берётся `GREATEST(...)` из применимых пунктов 1–3.

### 3.2 Пример расчёта (иллюстративный, для code review и unit-тестов)

**SRS-CAT-020** **[R1]** Запрос `«цытрамон»` (опечатка), `radiusMeters = 5000`, найден медикамент
«Цитрамон» (`trade_name` совпадает по триграмме, `similarity = 0.62`, `tsvector`-хита нет —
опечатка меняет буквы, `plainto_tsquery` не матчит лексему). В радиусе — 4 аптеки с товаром
(`offersCountInRadius = 4`), ближайшая на `800 м`, самая дешёвая цена в текущей странице
результатов — `12.00 TJS` (совпадает с ценой этого товара — единственный кандидат в примере, поэтому
`priceScore = 1.0`), у ближайшей аптеки `reliabilityScore = 4.2/5 = 0.84`.

```
textRelevance     = clamp((0.62 - 0.20) / 0.80, 0, 1) = 0.525
availabilityScore = min(4 / 3, 1.0)                   = 1.0
proximityScore    = 1 - min(800 / 5000, 1.0)          = 0.84
priceScore                                            = 1.0
reliabilityScore  = 0.84

finalScore = 0.40×0.525 + 0.20×1.0 + 0.15×0.84 + 0.15×1.0 + 0.10×0.84
           = 0.21 + 0.20 + 0.126 + 0.15 + 0.084
           = 0.770
```

### 3.3 SQL-реализация (расширение запроса 1 `11-database-schema.md`)

**SRS-CAT-021** **[R1]** `PostgresSearchProvider.search()` выполняет ОДИН составной запрос (не N+1):
внешний `SELECT` по `medicines` с `LATERAL JOIN` на ближайший/дешёвый оффер внутри радиуса, финальная
сортировка — по `finalScore DESC` (либо по явному `sort=price_asc|distance_asc`, минуя формулу
целиком — пользовательский явный выбор сортировки ВСЕГДА уважается буквально, композитная формула
применяется только при `sort=relevance`, дефолт):

```sql
WITH candidates AS (
    SELECT m.id, m.trade_name, m.inn_name, m.dosage_form, m.dosage_strength, m.image_url,
           m.is_prescription_required,
           GREATEST(
               (m.search_vector @@ plainto_tsquery('tajik_ru', :q))::int * 1.0,
               CASE WHEN (SELECT bool_or(w) FROM unnest(ARRAY[false]) w) THEN 0 ELSE 0 END, -- плейсхолдер для веса C, см. приложение application-слоя
               LEAST(GREATEST((similarity(m.trade_name, :q) - 0.20) / 0.80, 0), 1)
           ) AS text_relevance
    FROM medicines m
    JOIN pharmacy_chains pc ON true -- см. LATERAL ниже, вынесено для читаемости примера
    WHERE m.is_published = true
      AND m.control_category NOT IN ('psychotropic', 'narcotic')
      AND (m.search_vector @@ plainto_tsquery('tajik_ru', :q) OR m.trade_name % :q OR m.inn_name % :q)
), offers AS (
    SELECT c.id AS medicine_id,
           pi.pharmacy_id, ph.name AS pharmacy_name, pi.price_tjs, pi.stock_quantity,
           pi.last_synced_at,
           ST_Distance(ph.geo_point, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography) AS distance_m,
           COALESCE(prs.score, 3.5) AS reliability_score -- §14.1, дефолт для новой аптеки
    FROM candidates c
    JOIN pharmacy_inventory pi ON pi.medicine_id = c.id AND pi.stock_quantity > 0
    JOIN pharmacies ph ON ph.id = pi.pharmacy_id AND ph.status = 'active'
    JOIN pharmacy_chains pc2 ON pc2.id = ph.chain_id AND pc2.status IN ('approved', 'active')
    LEFT JOIN pharmacy_reliability_scores prs ON prs.pharmacy_id = ph.id
    WHERE ST_DWithin(ph.geo_point, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radius_m)
), aggregated AS (
    SELECT medicine_id,
           COUNT(*) AS offers_count,
           MIN(price_tjs) AS min_price,
           MIN(distance_m) AS nearest_distance,
           (ARRAY_AGG(pharmacy_id ORDER BY price_tjs ASC))[1] AS cheapest_pharmacy_id,
           (ARRAY_AGG(reliability_score ORDER BY price_tjs ASC))[1] AS cheapest_pharmacy_reliability
    FROM offers GROUP BY medicine_id
)
SELECT c.*, a.offers_count, a.min_price, a.nearest_distance, a.cheapest_pharmacy_id,
       a.cheapest_pharmacy_reliability,
       (
         0.40 * c.text_relevance
         + 0.20 * LEAST(COALESCE(a.offers_count, 0) / 3.0, 1.0)
         + 0.15 * (1 - LEAST(COALESCE(a.nearest_distance, :radius_m) / :radius_m, 1.0))
         + 0.15 * (1 - (a.min_price - MIN(a.min_price) OVER ()) /
                        NULLIF(MAX(a.min_price) OVER () - MIN(a.min_price) OVER (), 0))
         + 0.10 * (COALESCE(a.cheapest_pharmacy_reliability, 3.5) / 5.0)
       ) AS final_score
FROM candidates c
LEFT JOIN aggregated a ON a.medicine_id = c.id
ORDER BY final_score DESC NULLS LAST
LIMIT :limit;
```

> Примечание для реализующего разработчика: `priceScore`-подзапрос через `NULLIF(...,0)` покрывает
> вырожденный случай «одна уникальная цена на странице» (§3.1, правило «→ 1.0 для всех»);
> `NULLIF` даёт `NULL`, весь терм обнуляется — конечный шаг `application`-слоя обязан заменить `NULL`
> у `priceScore` на `1.0` явным `COALESCE` в TypeScript-мэппере результата (SQL-версия оставлена как
> заготовка, не финальный прод-код — финальная нормализация происходит в
   `RankingScoreMapper.normalize()`, покрытом unit-тестами домена без БД).

### 3.4 Перенормировка весов при отсутствии геолокации

**SRS-CAT-022** [Charter «мобильный трафик первичен», UX без запрошенного разрешения на геолокацию]
**[R1]** Given клиент не передал `geo` (пользователь не дал разрешение браузеру, либо запрос до
первого взаимодействия), When `SearchMedicinesUseCase.execute()`, Then `proximityScore` исключается
из формулы, а ОСТАЛЬНЫЕ веса перенормируются делением на `(1 − 0.15) = 0.85`:

```
textRelevance:     0.40 / 0.85 ≈ 0.471
availabilityScore: 0.20 / 0.85 ≈ 0.235
priceScore:        0.15 / 0.85 ≈ 0.176
reliabilityScore:  0.10 / 0.85 ≈ 0.118
```

Это ОБЩЕЕ правило перенормировки (не частный случай только для `proximityScore`) — при отсутствии
ЛЮБОЙ компоненты (например, `reliabilityScore` для новой аптеки без вычисленного значения — тогда
используется дефолт `3.5/5=0.7`, компонента НЕ исключается, только `priceScore`/`proximityScore`
реально могут отсутствовать структурно при отсутствии `geo`) веса оставшихся делятся на
`(1 − Σ исключённых весов)`.

**SRS-CAT-023** [Charter §7 «p95 < 300мс»] **[R1]** Given `filters.categoryId` задан, а `text = ''`
(режим браузинга категории без текстового запроса), When `SearchMedicinesUseCase`, Then
`textRelevance` для ВСЕХ кандидатов принудительно `1.0` (компонента не различает результаты — нет
текста для сравнения), формула вырождается в `availability+proximity+price+reliability`;
дефолтная сортировка в этом режиме — `sort='price_asc'` (не `relevance`), т.к. чистая композитная
формула без текстового якоря менее предсказуема для пользователя, browsing-режим ожидает явную
сортировку по цене (согласуется с позиционированием «дешевле рядом», §«Разбиение по релизам»).

---

## 4. Обработка запроса: язык, опечатки, транслит, штрихкод, МНН, производитель

**SRS-CAT-024** [SRS-DB-014..016, REQ-UX-14] **[R1]** `SearchMedicinesUseCase.execute()` перед
вызовом `SearchProvider.search()` пропускает сырой ввод `text` через пайплайн нормализации
(`QueryNormalizationService`, чистая функция домена, без внешних вызовов, `02` §2.6):

1. `trim()` + схлопывание повторных пробелов.
2. **Детекция штрихкода**: Given строка состоит ТОЛЬКО из цифр длиной `8|12|13|14`, Then запрос
   маршрутизируется в отдельную ветвь `searchByBarcode()`: `WHERE m.barcode = :text` (точное
   совпадение); Given не найдено — ветвь `searchByBarcode()` возвращает пустой результат, UI
   показывает `catalog.search.barcode_not_found` (i18n), НЕ падает в обычный текстовый фолбэк
   (штрихкод, набранный вручную или отсканированный, не является «опечатанным словом» — переход
   к триграммному фолбэку по 13 цифрам дал бы бессмысленные ложные совпадения).
3. **Транслит-нормализация** (SRS-DB-016): строка проверяется на «похожа на транслит таджикского
   латиницей/русской раскладкой без спецсимволов» эвристикой (доля латинских символов среди букв
   `> 60%` ИЛИ отсутствие ни одной буквы из набора `а-яёӣӯҳқғҷ`, но есть буквы вообще) — если да,
   применяется статическая таблица транслитерации `TransliterationNormalizerService`
   (`qalb→калб`, `gh→ғ`, `kh→х`, и т.д., полная таблица — файл `packages/i18n/translit-map.json`,
   курируется лингвистом/фармацевтом, не разработчиком произвольно); результат подставляется как
   ДОПОЛНИТЕЛЬНЫЙ вариант запроса (оба варианта — исходный и транслитерированный — передаются в
   `SearchProvider.search()` как `OR`-условие на уровне SQL `WHERE (... :q1 ...) OR (... :q2 ...)`),
   не заменяют исходный текст (пользователь мог быть прав с первого раза).
4. Обычный текст передаётся как есть в `tajik_ru`-конфигурацию FTS + `pg_trgm` (§2.2, §3).

**SRS-CAT-025** [D-06, REQ-SYNC-6] **[R1]** Поиск по МНН — не отдельная ветвь: `inn_name` уже
входит в `search_vector` весом `A` (та же приоритетность, что `trade_name`, `11-database-schema.md`
DDL) — запрос «парацетамол» находит и товары, где это торговое название, и товары, где это МНН
другого бренда, с одинаковым приоритетом. Отдельная UI-подсказка (не алгоритмическая ветвь)
«показать все аналоги» на карточке — это переход в блок §6, не часть текстового поиска.

**SRS-CAT-026** **[R1]** Поиск по производителю — `filter[manufacturerName]` (точный/`like`,
SRS-API-007), НЕ через основную текстовую строку по умолчанию (вес `C` в `search_vector` даёт
низкий приоритет совпадениям по `manufacturer_name` В ОСНОВНОМ тексте — так «Bayer» не должен
перебивать релевантный препарат по названию); явный фильтр — самостоятельный, высокоприоритетный
путь для пользователя, который целенаправленно ищет продукцию конкретного производителя.

---

## 5. Автодополнение (suggest)

**SRS-CAT-027** [REQ-UX-12, SRS-DB-019] **[R1]** `GET /api/v1/medicines/suggest?q=<text>&limit=10`:
debounce на клиенте `150–300 мс` (REQ-UX-12, реализация — `useDebouncedValue` хук
`packages/ui`/`shared/hooks`), отмена устаревших `fetch`-запросов через `AbortController` при новом
вводе (не дожидаться ответа на предыдущий символ). Источник — исключительно `medicines.trade_name` +
`medicines.inn_name` (НЕ `manufacturer_name` — подсказки по производителю избыточны для быстрого
автодополнения товара).

**SRS-CAT-028** **[R1]** Дедупликация: группировка по `lower(unaccent(trade_name))` — избегает
показа одинаково выглядящих строк «Цитрамон» × N разных `medicine.id` (разные производители/партии
одного бренда); канонический представитель группы — запись с максимальным `offersCountInRadius`
(если `geo` передан) или максимальным `similarity`/точным префиксным совпадением (если `geo`
отсутствует). Выбор клиентом подсказки переходит НЕ на `medicine.id` конкретной записи, а на
`GET /medicines/search?text=<tradeName>` (полный поиск по имени) — так пользователь видит ВСЕ
варианты, а не один произвольно выбранный.

**SRS-CAT-029** **[R1]** Правило переключения источника по длине ввода (SRS-DB-019, воспроизведено
здесь на уровне use case, не только SQL): `length(q) < 3` → префиксный `ILIKE 'q%'` через B-tree
(`ix_medicines_trade_name_prefix`, см. §14.2); `length(q) >= 3` → `pg_trgm`-похожесть (`%`-оператор)
объединённая с префиксным `UNION`, топ-30 по `score DESC`, дедуп (SRS-CAT-028), финальный `LIMIT 10`.

**SRS-CAT-030** [Пустой ввод] **[R1]** Given `q = ''` (поле в фокусе, ничего не введено), When
`GET /medicines/suggest`, Then сервер НЕ выполняет SQL-поиск по каталогу — возвращает:
(1) до 5 последних непустых поисковых запросов ЭТОГО браузера, восстановленных из `localStorage`
(client-side, без обращения к серверу вообще — быстрее и приватнее); ЕСЛИ история пуста (первый
визит) — (2) до 5 «популярных запросов» тенанта из кэша `Redis:trending_searches:{tenantId}`
(TTL 1 час, наполняется джобой аналитики из `search_query_log`, §14.3) — типичное cold-start
поведение популярных поисковых систем, не «пустой экран».

---

## 6. Подбор аналогов по МНН (Analog Engine)

### 6.1 Определение аналога (без изменений — цитата закона)

**SRS-CAT-031** [D-07, SRS-DOM-158, дословное воспроизведение из `10-domain-model.md`, НЕ
переопределение] **[R1]** Препарат `B` — аналог препарата `A` **И ТОЛЬКО ЕСЛИ**: (1) множество
`{substanceId}` идентично (не подмножество/пересечение); (2) `A.dosageFormClass ==
B.dosageFormClass` (точное совпадение укрупнённого класса, §6.2); (3) для каждого совпадающего
вещества — точное совпадение дозировки после конвертации единиц (§6.3, `Dosage.isEquivalentTo()`).
Сравнение по одной строке `inn_name` — запрещено как достаточное условие.

### 6.2 Совместимость форм выпуска

**SRS-CAT-032** [SRS-DOM-079, `dosage_form_class` enum — `11-database-schema.md`] **[R1]**
Таблица совместимости классов ДЛЯ ЦЕЛЕЙ БЛОКА АНАЛОГОВ (плашка экономии) — диагональная матрица,
класс эквивалентен ТОЛЬКО самому себе, без исключений:

| Класс A ＼ Класс B | tablet | capsule | syrup | injection | ointment | drops | inhaler | suppository | other |
|---|---|---|---|---|---|---|---|---|---|
| **tablet** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **capsule** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **syrup** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| *(остальные классы аналогично — только диагональ)* | | | | | | | | | |

**SRS-CAT-033** [Пограничный случай, важно для разработчика] **[R1]** «Таблетки↔капсулы» — ЧАСТАЯ
народная интуиция («это же одно и то же, просто другая оболочка»), но `dosage_form_class` содержит
`tablet` и `capsule` как РАЗНЫЕ значения enum (`11-database-schema.md`), и SRS-DOM-079 требует
ТОЧНОГО совпадения класса. Разработчик обязан реализовать таблицу §6.2 буквально (диагональ, БЕЗ
добавления `tablet↔capsule` как совместимой пары), даже если исходное ТЗ/заказчик интуитивно ожидал
взаимозаменяемость. Обоснование: капсула и таблетка одного вещества могут иметь разный профиль
высвобождения действующего вещества (биодоступность), а плашка экономии — юридически чувствительное
заявление об эквивалентности (§6.5, дисклеймер) — расширять его на визуально похожие, но
фармакологически не идентичные формы выпуска, не входит в полномочия автоматического движка без
отдельного медицинского обоснования. Разработчик, желающий смягчить это правило, обязан завести ADR
на имя архитектора — переоткрывать в коде без ADR запрещено (`03-ARCHITECT-DECISIONS.md`
преамбула). Аналогично: «сироп↔ампулы» — НЕ совместимы (разные пути введения, оральный vs
парентеральный) — тривиальный случай диагональной матрицы, упомянутый явно, т.к. отсутствие
исключений — не недосмотр, а дизайн.

### 6.3 Эквивалентность дозировки

**SRS-CAT-034** [SRS-DOM-077/078, `Dosage` VO из `10-domain-model.md`] **[R1]** `Dosage.parse()`
разбирает `dosage_value`(`NUMERIC(10,4)`)+`dosage_unit`(enum) на структуру `{value, unit}`.
`isEquivalentTo(other)` — ТОЧНОЕ совпадение ПОСЛЕ конвертации в базовую единицу СЕМЕЙСТВА:
- Масса (`mg|mcg|g`): конвертация целочисленная через `bigint`-множитель в микрограммы
  (`1g = 1_000_000mcg`, `1mg = 1_000mcg`), затем точное `===`.
- Объём (`ml`): не конвертируется в массу — сравнение только `ml` с `ml`.
- Активность (`iu`)/`percent`/`mg_per_ml`: сравнение только внутри своей единицы, без кросс-конверсии.
`DOSAGE_EQUIVALENCE_TOLERANCE_PCT = 0` (константа, дефолт без допуска) — терапевтическая
эквивалентность требует ТОЧНОГО совпадения, не «примерно похоже».

**SRS-CAT-035 — Разбор кейса «500 мг × 2 vs 1000 мг × 1» (обязательный пограничный случай)**
[SRS-DOM-078, разбор для разработчика] **[R1]** Given препарат A — таблетки `500 мг`, препарат
B — таблетки `1000 мг` того же вещества, When `AnalogEquivalenceService` сравнивает `A.dosage` и
`B.dosage`, Then результат — **НЕ эквивалентны** (`isEquivalentTo() === false`), несмотря на то что
«2 таблетки по 500 мг» суммарно дают ту же дозу вещества, что «1 таблетка по 1000 мг». Причины,
обязательные для понимания разработчиком (не баг, дизайн-решение по SRS-DOM-078):
1. Домен сравнивает дозировку ЕДИНИЦЫ ВЫПУСКА (одна таблетка/капсула/мл), а не суммарную суточную
   дозу — у `Medicine`/`Dosage` НЕТ понятия «количество единиц в приёме», это относится к схеме
   приёма (посологии), которую назначает врач/фармацевт, а не автоматический движок каталога.
2. Допуск «сумма эквивалентна» открыл бы дверь к неконтролируемым комбинаторным сравнениям
   (`250мг×4` тоже «эквивалентно» `1000мг×1`? а `333мг×3`? — есть погрешность округления кратности),
   что превращает детерминированный алгоритм в эвристику с погрешностью — недопустимо для блока,
   показывающего юридически значимое заявление об экономии/эквивалентности (§6.5).
3. Пользователь, которому подошёл бы вариант «2×500мг», всё равно увидит его в результатах ОБЫЧНОГО
   поиска (§2–§4) по тому же МНН — просто не в АВТОМАТИЧЕСКОМ блоке аналогов, а как отдельная
   позиция каталога с собственной карточкой, где кратность приёма пользователь/фармацевт оценивает
   осознанно, не как алгоритмическую подстановку.

`TC-CAT-010` (§«Тестовые сценарии») закрепляет это поведение как обязательный regression-тест —
падение теста при случайном «улучшении» алгоритма в сторону суммарной эквивалентности является
блокирующим регрессом, не багфиксом.

### 6.4 Расчёт экономии и текст плашки

**SRS-CAT-036** [SRS-DOM-159, REQ-MARKET-3] **[R1]** `savingsDiram = referenceMedicine.displayPrice
− cheapestAnalog.displayPrice`, где `referenceMedicine` — товар, изначально найденный пользователем
(НЕ обязательно самый дорогой в списке), `cheapestAnalog` — минимальная цена среди аналогов с
`stock_quantity > 0` в радиусе поиска пользователя (дефолт `SEARCH_DEFAULT_RADIUS_METERS = 5000`,
переопределяемый пользователем через фильтр радиуса, §7.1 — использует ТОТ ЖЕ радиус, что и текущий
поисковый контекст, не отдельный параметр). Список аналогов сортируется `ORDER BY price_tjs ASC`
(SRS-DOM-158 дословно) — БЕЗ применения формулы §3.

**SRS-CAT-037** **[R1]** Given `savingsDiram <= 0` (ни один аналог не дешевле референсного товара
в радиусе), Then блок экономии НЕ рендерится (UI-правило, SRS-DOM-159) — список аналогов как таковой
всё ещё может отображаться (просто без плашки «сэкономьте»), если у пользователя есть причина
интересоваться альтернативами (другой производитель, другая аптека рядом) — но заголовок блока в
этом случае — `catalog.analogs.title_neutral` («Другие варианты с тем же действующим веществом»), не
`catalog.analogs.title_savings` («Сэкономьте X сомони»).

**SRS-CAT-038** [REQ-MARKET-3 — точный расчёт, разброс ×9.8–10 без округления] **[R1]** Текст плашки
(i18n-ключ `catalog.analogs.savings_banner`, параметризованный):

```
RU: «Сэкономьте {{amount}} сомони: найден аналог с тем же действующим веществом
     ({{substanceNames}}) за {{cheapPrice}} сомони вместо {{refPrice}} сомони»
TJ (⚠ требует вычитки): «{{amount}} сомонӣ сарфа кунед: аналоги бо ҳамон моддаи фаъол
     ({{substanceNames}}) бо нархи {{cheapPrice}} сомонӣ ба ҷои {{refPrice}} сомонӣ ёфт шуд»
EN: «Save {{amount}} TJS: found an analog with the same active substance
     ({{substanceNames}}) for {{cheapPrice}} TJS instead of {{refPrice}} TJS»
```

`{{amount}}`/`{{cheapPrice}}`/`{{refPrice}}` форматируются через `Intl.NumberFormat` с ДВУМЯ
знаками после запятой, БЕЗ округления до «круглых» чисел (домен хранит целые дирамы — конвертация
`money.toDbDecimalTjs()`, `10-domain-model.md` SRS-DOM-065 — единственный легальный путь
форматирования, не `Math.round`).

### 6.5 Обязательные юридические дисклеймеры

**SRS-CAT-039** [REQ-NORM-3, `10-domain-model.md` глоссарий «Аналог»] **[R1]** КАЖДЫЙ рендеринг
блока аналогов (не только при первом показе — постоянно видимый текст, не «показать один раз и
закрыть») сопровождается дисклеймером, i18n-ключ `catalog.analogs.disclaimer`:

```
RU: «Это не медицинская рекомендация. Указанные препараты содержат одинаковый набор действующих
     веществ в равной дозировке, но могут отличаться вспомогательными веществами и производителем.
     Перед заменой препарата проконсультируйтесь с фармацевтом или врачом.»
TJ (⚠ требует вычитки носителем/фармацевтом перед продакшен-релизом): «Ин тавсияи тиббӣ нест.
     Доруҳои нишондодашуда моддаҳои фаъоли якхела бо миқдори баробар доранд, аммо моддаҳои ёрирасон
     ва истеҳсолкунанда метавонанд фарқ кунанд. Пеш аз иваз кардани дору бо фармасевт ё духтур
     машварат кунед.»
EN: «This is not medical advice. These products contain the same active substances at an
     equivalent strength, but may differ in excipients and manufacturer. Consult a pharmacist
     or doctor before switching medication.»
```

**SRS-CAT-040** [D-08, SRS-DOM-157] **[R1]** Given любой аналог в списке имеет
`is_prescription_required = true` (включая `control_category = 'potent'`), Then ДОПОЛНИТЕЛЬНО
рендерится бейдж `catalog.analogs.rx_required_badge` («Требуется рецепт» / «Бо нусха» / «Prescription
required») рядом с этой конкретной карточкой аналога — не общий баннер над всем списком (список
может содержать смесь Rx/OTC аналогов одного вещества в разных дозировках/формах — маловероятно при
точном совпадении дозировки, но НЕ невозможно при разных производителях с разным регуляторным
статусом в РТ).

**SRS-CAT-041** [Юридический текст, версионирование] **[R1]** Текст дисклеймера — версионируемая
запись в `i18n_overrides` (таблица `11-database-schema.md` строка 1373, уже определена) с ключом
`catalog.analogs.disclaimer`, НЕ хардкод в компоненте React (Charter §5 «хардкод строки = дефект»).
Юрист/продакт-оунер обязан завизировать финальный текст ДО первого продакшен-релиза — до визирования
используется версия выше как ASSUMPTION-плейсхолдер, помеченная в `apps/admin` статусом
`pending_legal_review` (доп. поле, §14.4).

### 6.6 Оркестрация: слои

**SRS-CAT-042** [`02` §2/§3, SRS-DOM-017] **[R1]** Разделение по слоям:

- **domain** (`modules/catalog/domain/services/analog-equivalence.service.ts`) —
  `AnalogEquivalenceService.isAnalog(a: Medicine, b: Medicine): boolean` — ЧИСТАЯ функция без I/O,
  реализует §6.1–6.3 буквально, читает только уже загруженные в память агрегаты `Medicine`
  (включая `MedicineSubstance[]`), не делает запросов к БД. Юнит-тестируется без БД (`02` §6 порог
  покрытия domain ≥90%).
- **application** (`modules/catalog/application/use-cases/find-analogs.use-case.ts`) —
  `FindAnalogsUseCase.execute({ medicineId, geo, radiusMeters, tenantId })`: (1) загружает
  `referenceMedicine` через `CatalogRepository` (порт); (2) запрашивает кандидатов (та же
  `dosageFormClass`, пересечение по хотя бы одному веществу — грубый SQL-предфильтр, запрос 3 из
  `11-database-schema.md`, здесь ТОЛЬКО как оптимизация выборки кандидатов, НЕ финальное решающее
  правило); (3) для каждого кандидата вызывает `AnalogEquivalenceService.isAnalog()` — финальное,
  авторитетное решение принимается ЗДЕСЬ, в памяти, а не доверяется SQL-приближению; (4) запрашивает
  цену/остаток/дистанцию через `InventoryFacade`/`PostgresSearchProvider`-подобный read-порт;
  (5) вычисляет `savingsDiram` (SRS-CAT-036); (6) возвращает DTO.
- **infrastructure** — `CatalogRepository` (Drizzle), реализующий SQL-предфильтр запроса 3.
- **presentation** — `GET /api/v1/medicines/:id/analogs` контроллер, маппинг DTO→JSON, дисклеймер
  подставляется на этом уровне из `i18n_overrides` по резолвленной `Accept-Language` (SRS-API-008).

**SRS-CAT-043** [Почему SQL-предфильтр не является законом] **[R1]** Запрос 3 из
`11-database-schema.md` (сравнение через `array_agg`-равенство множеств `substance_id`) — БЫСТРЫЙ,
но неполный по эквивалентности дозировки (сравнивает только «то же множество веществ + не найдено
несовпадений по значению при равной единице» — НЕ обрабатывает конвертацию единиц массы, например
`500 mcg` vs `0.5 mg`, которые эквивалентны ПОСЛЕ конвертации, но `strength_unit` в SQL не совпадает
буквально). Поэтому SQL — только сужение кандидатов (топ-50 по совпадению множества веществ), финальная
проверка — ВСЕГДА `Dosage.isEquivalentTo()` в `application`/`domain`. Расхождение SQL-предфильтра и
domain-правила — не дефект, а сознательное разделение «быстрая грубая выборка» / «точное решение».

---

## 7. Фильтры, сортировки, гео-фильтр

### 7.1 Гео-фильтр (радиус)

**SRS-CAT-044** [R1-6] **[R1]** Селектор радиуса — фиксированный набор `{1000, 3000, 5000, 10000,
20000}` метров (не произвольный слайдер — предсказуемые ступени проще тестировать и кэшировать,
§11), дефолт `5000`. Значение вне набора → `400 VALIDATION_ERROR` (`details.field='radiusMeters'`).
Отсутствие `geo` при заданном `radiusMeters` → радиус игнорируется целиком (нет опорной точки),
`400 VALIDATION_ERROR` НЕ возвращается (радиус без гео — не ошибка клиента, а неприменимый параметр,
тихо игнорируется, т.к. частый кейс — сохранённое в URL значение из прошлой сессии с гео).

### 7.2 «Только в наличии»

**SRS-CAT-045** [Позиционирование продукта — экономия важнее полноты каталога] **[R1]** Дефолт
`inStockOnly = false`: результаты БЕЗ остатка в радиусе всё равно показываются (со визуальной
пометкой «нет в наличии рядом», приглушённый стиль карточки), чтобы не создавать у пользователя
ложное впечатление «такого препарата не существует». Переключение `inStockOnly = true` скрывает их
полностью из списка (не просто перекрашивает) — SQL: `INNER JOIN pharmacy_inventory ... WHERE
stock_quantity > 0` вместо `LEFT JOIN`.

### 7.3 «Открыто сейчас» / «24/7»

**SRS-CAT-046** [`pharmacies.opening_time`/`closing_time`/`is_24_7`, часовой пояс `Asia/Dushanbe`]
**[R1]** «Открыто сейчас» = `is_24_7 = true OR (текущее время в Asia/Dushanbe между opening_time и
closing_time)`. Алгоритм обязан обрабатывать интервалы, переходящие через полночь
(`closing_time < opening_time`, например аптека работает `20:00–02:00`):

```typescript
function isOpenNow(now: TimeOfDay, opening: TimeOfDay, closing: TimeOfDay): boolean {
  if (closing >= opening) {
    return now >= opening && now <= closing;             // обычный интервал в пределах суток
  }
  return now >= opening || now <= closing;                // интервал переходит через полночь
}
```

Текущее время вычисляется ИСКЛЮЧИТЕЛЬНО через `ClockPort.nowInTenantTz()` (`12-api-conventions...`
SRS-API-008) на границе `infrastructure` — фильтр НЕ реализуется в `domain` (`02` §2.6, домен чист от
`Date.now()`), а как `application`-сервис `PharmacyOpeningHoursPolicy`, принимающий `Clock` через
конструктор (тестируется с фиксированным временем без реального ожидания).

**SRS-CAT-047** **[R1]** «24/7» — простой фильтр `is_24_7 = true`, независим от «открыто сейчас»
(круглосуточная аптека всегда проходит оба фильтра одновременно, если оба включены).

### 7.4 Сортировки

**SRS-CAT-048** [SRS-API-006] **[R1]** Разрешённые значения `sort`: `relevance` (дефолт при
непустом `text`), `price_asc`, `price_desc`, `distance_asc` (требует `geo`, иначе
`400 VALIDATION_ERROR details.field='sort'` с уточнением «distance_asc requires geo»).

---

## 8. Карточка товара

**SRS-CAT-049** [Полный состав данных] **[R1]** `GET /api/v1/medicines/:id` возвращает:

```json
{
  "data": {
    "id": "...", "tradeName": "Цитрамон", "innName": "Ацетилсалициловая кислота + Кофеин + Парацетамол",
    "dosageForm": "таблетки", "dosageFormClass": "tablet", "dosageStrength": "500 мг + 50 мг + 200 мг",
    "manufacturerName": "...", "manufacturerCountry": "...",
    "controlCategory": "none", "isPrescriptionRequired": false, "requiresColdChain": false,
    "imageUrl": "https://.../minio/...", "description": "...",
    "substances": [
      { "substanceId": "...", "innName": "Ацетилсалициловая кислота", "strengthValue": 500, "strengthUnit": "mg" }
    ],
    "offers": [ /* PharmacyOffer[], §2.1, сортировка по умолчанию price_asc в контексте карточки */ ],
    "hasAnalogs": true
  }
}
```

**SRS-CAT-050** **[R1]** `offers` в карточке товара — ВСЕ активные предложения (не ограничено
радиусом поиска, если пользователь не задал `radiusMeters` явно параметром запроса карточки) с
`isStale`-пометкой (§14.3) для просроченных по SLA данных. `hasAnalogs: true/false` — предвычисленный
флаг (не требует отдельного запроса для решения «показывать ли ссылку „Найти аналоги"» на UI) —
вычисляется тем же `FindAnalogsUseCase` с `limit=1` (существование хотя бы одного аналога), НЕ
полным списком (экономия на JOIN при простом рендере карточки).

**SRS-CAT-051** [Предупреждение о дубле действующего вещества] **[R1]** Не часть карточки товара
как таковой — реализуется в контексте `orders`/`cart` (`AddToCartUseCase`), но ЗАВИСИТ от
`CatalogFacade.getSubstances(medicineId)`: given в корзине уже есть товар с пересекающимся множеством
`substances` (не обязательно идентичным — ЧАСТИЧНОЕ пересечение допустимо для срабатывания
предупреждения, в отличие от строгого равенства для аналогов §6.1), When добавляется новый товар,
Then `cart`-контроллер возвращает `200` с `meta.warnings: [{ code: 'DUPLICATE_ACTIVE_SUBSTANCE',
substanceNames: [...] }]` — НЕ блокирует добавление (REQ-SAFETY-1: предупреждение, не блокировка).
`CatalogFacade.getSubstances(ids: string[]): Promise<Map<medicineId, SubstanceId[]>>` — единственный
метод, экспортируемый публичным фасадом `catalog` для этой цели (`02` §1.2).

---

## 9. Карта аптек

**SRS-CAT-052** [REQ-GEO-1, R1-6] **[R1]** `GET /api/v1/pharmacies/map?bbox=<lonMin,latMin,lonMax,
latMax>&medicineId=<uuid?>` — возвращает пины в границах видимой области карты (не радиус — `bbox`
эффективнее для панорамирования карты клиентом, `ST_MakeEnvelope` + `&&` оператор GiST, отдельный
от `ST_DWithin` путь §3). Given `medicineId` передан, Then каждый пин несёт `{ price, stockQuantity,
lastSyncedAt }` для ЭТОГО конкретного медикамента (используется при переходе «показать на карте» с
карточки товара); given `medicineId` отсутствует — пин несёт только статические данные аптеки
(`name, isOpenNow, is24x7`), без цены.

**SRS-CAT-053** **[R1]** Рендер карты — `MapLibre GL JS` + self-hosted vector-tile сервер
(REQ-GEO-1, Yandex Maps запрещён ToS для диспетчеризации) — тайл-сервер (`infra/docker/tileserver`)
НЕ входит в этот документ (инфраструктурный сетап, `01-TECH-BASELINE.md`), здесь специфицируется
только контракт данных пинов.

**SRS-CAT-054** [Ограничение нагрузки] **[R1]** `bbox`, покрывающий площадь `> BBOX_MAX_AREA_KM2`
(ASSUMPTION 2500 км² — примерно весь Душанбе с пригородом с запасом), → `400 VALIDATION_ERROR
details.field='bbox'` — предотвращает случайный запрос «вся территория Таджикистана» с клиента,
уменьшенного до предела зума.

---

## 10. Безопасность каталога и поиска

**SRS-CAT-055** [D-08, SRS-DOM-157, дублирование намеренное — оборонительная многослойность] **[R1]**
`psychotropic`/`narcotic` исключаются на ТРЁХ независимых рубежах одновременно: (1) `WHERE
control_category NOT IN (...)` в каждом SQL-запросе поиска/карточки/аналогов/автодополнения/карты
(этот документ); (2) `SRS-DOM-005` — доменный инвариант конструктора `Order` не даёт заказать, даже
если бы позиция каким-то образом просочилась в ответ API; (3) `is_globally_identifiable_by_barcode`/
модерация (D-06/D-08) не допускает автоматическую публикацию такой позиции без ручной курации
(`medicine.publish()` не переводит новую запись в публичный статус, минуя `moderation`, для кандидата
с признаками контролируемого вещества, `NewControlCategoryCandidateEvent`). Ни один из трёх рубежей
не полагается на то, что предыдущий сработал корректно (defense in depth, тот же принцип
SRS-API-045).

**SRS-CAT-056** [`potent`, продажа разрешена, но без специальной рекламы, REQ-REG-19/20] **[R1]**
`control_category = 'potent'` не исключается из поиска, НО: (1) не участвует ни в одной «топ-N
предложений дня» / промо-подборке (отдельный флаг `isPromotable` на уровне `application`, вычисляется
как `controlCategory NOT IN ('potent','psychotropic','narcotic')`); (2) карточка/результат поиска
обязательно несёт бейдж Rx (§6.5, SRS-CAT-040) — не только в блоке аналогов, но и в основной выдаче
поиска/автодополнении.

**SRS-CAT-057** [Rate limiting поиска] **[R1]** `GET /medicines/search` и `/medicines/suggest`
подпадают под общий анонимный лимит `RATE_LIMIT_ANON_PER_MIN = 100` (`12-api-conventions...`
SRS-API-012) — отдельного, более строгого лимита не вводится (публичный, часто вызываемый эндпоинт,
дополнительное ограничение создало бы UX-деградацию автодополнения при интенсивном наборе текста).

---

## 11. Кэширование

**SRS-CAT-058** [Charter §7 «p95 < 300 мс»] **[R1]** Таблица кэшируемых сущностей:

| Что | Где | TTL | Ключ | Инвалидация |
|---|---|---|---|---|
| Дерево категорий | Redis | 6 ч | `catalog:categories:{tenantId}` | Явный вызов при `apps/admin` правке категории (`CategoryUpdatedEvent`, application-уровня, не доменное событие) |
| Карточка медикамента (без офферов) | Redis | 15 мин | `catalog:medicine:{medicineId}:{locale}` | `MedicinePublishedEvent`/правка полей (админка) |
| Результаты поиска (полная страница) | Redis | **30 сек** (короткий TTL — цены/остатки меняются часто) | `catalog:search:{tenantId}:{hash(query+filters+geo+radius+sort+cursor)}` | Пассивная (TTL-истечение) — АКТИВНАЯ инвалидация НЕ используется для этого ключа: цена/остаток меняются слишком часто (1С/Excel-синхронизация), инвалидировать по событию means invalidating on every batch — короткий TTL проще и достаточен (SLA дельта-синка — 5 минут, D-04, кэш поиска на 2 порядка короче) |
| Trending searches | Redis | 1 ч | `trending_searches:{tenantId}` | Пассивная + периодический пересчёт джобой (§14.3) |
| Автодополнение | Redis | 5 мин | `catalog:suggest:{tenantId}:{normalizedQuery}` | Пассивная |
| `pharmacy_reliability_scores` | Postgres-таблица (не Redis — читается редко относительно записи джобой) | — (пересчитывается ежесуточно, §14.1) | — | — |

**SRS-CAT-059** [Инвалидация при синхронизации остатков] **[R1]** `InventorySyncBatchCompletedEvent`
(уже существующее доменное событие, `10-domain-model.md`) НЕ используется для точечной инвалидации
кэша результатов поиска (см. обоснование в таблице выше — короткий TTL важнее точности здесь), НО
используется для инвалидации кэша КАРТОЧКИ конкретных затронутых `medicineId` (батч содержит список
позиций — `catalog:medicine:{medicineId}:*` удаляется по маске для каждой позиции батча) — карточка
живёт дольше (15 мин) и точечная инвалидация оправдана количеством (десятки позиций на батч, не
тысячи комбинаций фильтров поиска).

**SRS-CAT-060** [Cache stampede] **[R1]** Ключ результатов поиска — `SET ... NX PX <ttl>` с
паттерном «первый промах кэша вычисляет и пишет, конкурентные промахи того же ключа в узком окне
ждут через короткий `sleep+retry` (`50мс×3`), не дублируют вычисление» (`RedisLockGuard`,
infrastructure-утилита, НЕ доменная логика) — предотвращает N параллельных тяжёлых SQL-запросов на
один и тот же ключ при пиковой нагрузке (несколько пользователей ищут одно и то же слово одновременно
после истечения TTL).

---

## 12. Производительность

**SRS-CAT-061** [Charter §7, D-05] **[R1]** Целевые p95:

| Эндпоинт | Целевой p95 | Обоснование |
|---|---|---|
| `GET /medicines/search` (кэш-промах) | < 250 мс | Composite SQL §3.3 — один запрос, GIN+GiST индексы |
| `GET /medicines/search` (кэш-хит) | < 30 мс | Redis round-trip |
| `GET /medicines/suggest` | < 80 мс | Короткий LIMIT, префиксный B-tree для коротких строк |
| `GET /medicines/:id` | < 100 мс (кэш-промах), < 20 мс (кэш-хит) | Одна запись + JOIN офферов |
| `GET /medicines/:id/analogs` | < 300 мс | SQL-предфильтр (топ-50) + доменная проверка в памяти на ≤50 кандидатах — O(50), не O(N) по всему каталогу |
| `GET /pharmacies/map` | < 200 мс | GiST bbox-запрос, `LIMIT 500` пинов на ответ (клиент кластеризует визуально при зуме) |

**SRS-CAT-062** [План запросов и индексы — используются уже определённые в `11-database-schema.md`,
без дублирования DDL] **[R1]** Поиск/ранжирование (§3.3) опирается на:
`ix_medicines_search_vector` (GIN), `ix_medicines_trade_name_trgm`/`ix_medicines_inn_name_trgm` (GIN
trgm), `ix_medicines_control_category` (частичный), `ix_medicines_published` (частичный),
`ix_pharmacy_inventory_pharmacy`/`ix_pharmacy_inventory_medicine` (частичные, `WHERE stock_quantity >
0`), `ix_pharmacies_geo_point` (GiST). Дополнительно вводится (§14.2) `ix_medicines_trade_name_prefix`
для `length(q)<3` веток автодополнения — B-tree на `lower(unaccent(trade_name)) text_pattern_ops`,
т.к. GIN trgm неэффективен для запросов короче 3 символов (SRS-DB-019 уже утверждает это правило,
здесь только конкретный недостающий индекс).

**SRS-CAT-063** [Нагрузочный профиль k6] **[R1]** `tests/load/catalog-search.k6.js`: смешанный
профиль `70% search / 20% suggest / 10% analogs`, целевая устойчивая нагрузка `200 req/sec` (Charter
не даёт отдельной цифры для поиска — консервативная оценка на объём ~10k SKU и профиль трафика
розничного маркетплейса РТ, ASSUMPTION), сценарий фиксирует деградацию p95 >250 мс как провал теста.

---

## 13. Публичный контракт модуля (`CatalogFacade`) и use cases

**SRS-CAT-064** [`02` §1.2] **[R1]** `modules/catalog/index.ts` экспортирует ИСКЛЮЧИТЕЛЬНО:

```typescript
export interface CatalogFacade {
  getMedicineSnapshot(ids: readonly string[]): Promise<Map<string, MedicineSnapshot>>; // для orders (SRS-DOM-107)
  getSubstances(ids: readonly string[]): Promise<Map<string, SubstanceRef[]>>;         // для cart-дубль-предупреждения (§8)
  resolveMedicineByComposite(input: CompositeMatchInput): Promise<MedicineMatchResult>; // для inventory (D-06)
  isVisible(medicineId: string): Promise<boolean>;                                       // для moderation-отчётности
}
// Доменные события, публикуемые catalog: MedicinePublishedEvent (application-уровня),
// NewControlCategoryCandidateEvent (уже определён 10-domain-model.md).
// Типы MedicineSnapshot/SubstanceRef/CompositeMatchInput/MedicineMatchResult — публичные, экспортируются рядом.
```

Ничего из `modules/catalog/domain/*`, `application/*` (кроме use cases, вызываемых `presentation`
этого ЖЕ модуля), `infrastructure/*` не импортируется другими модулями напрямую — только через этот
файл (`02` §1.2, `10-domain-model.md` SRS-DOM-001).

**SRS-CAT-065** [Полный список use cases модуля] **[R1]** `SearchMedicinesUseCase`,
`SuggestMedicinesUseCase`, `GetMedicineDetailUseCase`, `FindAnalogsUseCase`, `GetCategoryTreeUseCase`,
`GetPharmacyMapPinsUseCase`. Каждый — один класс, один публичный метод `execute()` (`02` §3.1),
получает порты (`SEARCH_PROVIDER`, `CatalogRepository`, `InventoryReadPort`) через конструктор.

---

## 14. Дополнения к схеме БД

> Обязательный раздел (инструкция оркестратора). Каждое дополнение обосновано требованием ВЫШЕ,
> которое `11-database-schema.md` не покрывает, — не переопределяет существующие таблицы/поля.

### 14.1 `pharmacy_reliability_scores` — операционная надёжность аптеки (для §3 ранжирования)

**SRS-CAT-066** **[R1]** Формула ранжирования (§3.1) требует «рейтинг аптеки», которого нет в схеме
как отзывов/оценок покупателей (система отзывов НЕ входит в scope R1 — ни один CUJ/REQ её не
описывает). Вместо выдуманного внешнего источника вводится ОПЕРАЦИОННАЯ метрика, вычислимая из уже
существующих данных (`orders`, без нового внешнего контракта — Charter §5 «не выдумывать внешние
API»):

```sql
CREATE TABLE pharmacy_reliability_scores (
    pharmacy_id UUID PRIMARY KEY REFERENCES pharmacies(id) ON DELETE CASCADE,
    score NUMERIC(3, 2) NOT NULL DEFAULT 3.50,  -- 0.00..5.00, дефолт для новой/безданных аптеки
    orders_considered INT NOT NULL DEFAULT 0,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_reliability_score_range CHECK (score BETWEEN 0 AND 5)
);
COMMENT ON TABLE pharmacy_reliability_scores IS
    'Read-модель (analytics/catalog), НЕ доменный агрегат PharmacyAccount. Пересчитывается '
    'ежесуточной джобой RecomputePharmacyReliabilityJob из orders/order_status. Используется '
    'ИСКЛЮЧИТЕЛЬНО как входной сигнал формулы ранжирования поиска (SRS-CAT-018), не отображается '
    'пользователю как публичный "рейтинг" (нет UI-виджета звёзд — во избежание ложного впечатления '
    'отзывов, которых нет, REQ-UX/Charter i18n не описывают такой виджет).';
```

**SRS-CAT-067** [Формула, ASSUMPTION] **[R1]** `RecomputePharmacyReliabilityJob` (BullMQ repeatable,
ежесуточно 04:00 `Asia/Dushanbe`, после ночной полной 1С-синхронизации 03:00, D-04):

```
score = 5 × (1 − min(1, (cancelledByPharmacistCount + slaBreachedCount) / totalProcessingOrders))
```

за скользящее окно `RELIABILITY_WINDOW_DAYS = 90` (ASSUMPTION). Given `totalProcessingOrders <
RELIABILITY_MIN_SAMPLE_SIZE` (ASSUMPTION `20`) за окно (новая аптека/низкий трафик — статистически
недостоверная выборка), Then `score` НЕ пересчитывается, остаётся дефолт `3.50` (нейтральное
значение — не наказывает и не поощряет аптеку без истории). Владелец расчёта — контекст `analytics`
(read-модель, `10-domain-model.md` «analytics ← (все контексты) [E]»), пишет напрямую в эту таблицу
(отдельную от `pharmacies`/`PharmacyAccount` — НЕ требует прохождения через `OnboardingFacade`, т.к.
это read-model проекция, а не изменение состояния агрегата `PharmacyAccount`).

### 14.2 Индекс автодополнения для коротких запросов

**SRS-CAT-068** [SRS-DB-019, §5] **[R1]**

```sql
CREATE INDEX ix_medicines_trade_name_prefix
    ON medicines (lower(unaccent(trade_name)) text_pattern_ops)
    WHERE is_published = true;
```

### 14.3 `search_query_log` — журнал поисковых запросов (аналитика + trending)

**SRS-CAT-069** [R1-15 «Продуктовая аналитика — обязательно», `04-SCOPE-DECISION-PIVOT.md` §3.1,
§5 «пустой ввод»] **[R1]**

```sql
CREATE TABLE search_query_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL для гостя
    query_text VARCHAR(255) NOT NULL,
    results_count INT NOT NULL,
    clicked_medicine_id UUID REFERENCES medicines(id) ON DELETE SET NULL, -- заполняется отдельным событием клика, nullable
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_search_query_log_trending ON search_query_log (tenant_id, created_at DESC);
COMMENT ON TABLE search_query_log IS
    'Источник для (а) trending searches при пустом вводе (§5, SRS-CAT-030), (б) воронки R1-15 '
    '(показ экономии -> клик на аналог -> корзина -> заказ) — analytics читает эту таблицу и '
    'search_query_log JOIN order_items по clicked_medicine_id для расчёта конверсии.';
```

**SRS-CAT-070** [Приватность] **[R1]** `query_text` НЕ логирует персональные данные напрямую (сам
текст поискового запроса — не PII в юридическом смысле для медикаментов, но ОБРАЩЕНИЕ к конкретному
диагнозу через поиск теоретически чувствительно) — таблица подпадает под общую политику хранения
`audit_log`-подобных записей (retention — ASSUMPTION 180 дней, фоновая job очистки), не хранится
бессрочно.

### 14.4 `i18n_overrides` — статус юридической вычитки дисклеймера

**SRS-CAT-071** [§6.5, `i18n_overrides` уже существует в `11-database-schema.md`] **[R1]** Не новая
таблица — используется существующая `i18n_overrides` (строка 1373), но требуется дополнительное поле,
отсутствующее в исходном DDL:

```sql
ALTER TABLE i18n_overrides ADD COLUMN review_status VARCHAR(20) NOT NULL DEFAULT 'pending_legal_review';
-- 'pending_legal_review' | 'approved' — блокирует ТОЛЬКО visual-индикатор в apps/admin
-- ("этот текст ещё не утверждён юристом"), НЕ блокирует показ пользователю (текст дисклеймера
-- обязан отображаться с первого дня, даже в ASSUMPTION-версии — отсутствие дисклеймера хуже
-- неидеальной формулировки, REQ-NORM-3 категоричен: дисклеймер ОБЯЗАТЕЛЕН).
```

---

## Пограничные случаи и ошибки

**SRS-CAT-072** [Гонка: цена товара меняется между показом результата поиска и открытием карточки]
**[R1]** Given результат поиска закэширован (§11, TTL 30с) с ценой `X`, When пользователь открывает
карточку через `>30` секунд после получения списка (1С прислала новую цену `Y` за это время), Then
карточка товара — ВСЕГДА свежий запрос (кэш карточки отдельный, TTL 15 мин, но инвалидируется
точечно по `InventorySyncBatchCompletedEvent`, SRS-CAT-059, значит цена на карточке актуальнее цены
устаревшего результата списка) — расхождение «в списке было X, на карточке Y» — ОЖИДАЕМОЕ и
корректное поведение (список — не гарантия цены, только приглашение открыть карточку), НЕ показывать
пользователю как ошибку.

**SRS-CAT-073** [Гонка: аптека переходит в `suspended` между поиском и добавлением в корзину]
**[R1]** Given `pharmacy.status` был `active` в момент рендера результата поиска, When пользователь
кликает «добавить в корзину» после того как `PharmacySuspendedEvent` уже произошёл (окно в секунды/
минуты), Then `AddToCartUseCase` (модуль `orders`, не этот документ) обязан выполнить СВЕЖУЮ
проверку `pharmacy.status = 'active'` в момент добавления (не доверять клиентскому состоянию из
результата поиска) — возвращает `422 BUSINESS_RULE_VIOLATION details.reason='pharmacy_suspended'`,
UI предлагает обновить список результатов. Этот документ специфицирует только то, что `catalog`/
`search` НЕ несёт ответственности за финальную проверку доступности на момент покупки — она
происходит на границе `orders`.

**SRS-CAT-074** [Дублирующиеся строки каталога после composite-матчинга] **[R1]** Given две разные
аптеки прислали одну и ту же позицию с чуть разным написанием (`«Цитрамон П»` vs `«Цитрамон-П»`) и
composite-матчинг (D-06, отдельный документ `inventory`) ошибочно создал ДВЕ РАЗНЫЕ строки
`medicines` вместо связывания с одной, When пользователь ищет «цитрамон», Then поиск покажет ОБЕ
записи как отдельные результаты (это ожидаемое поведение уровня `catalog`/`search` — разрешение
дублей каталога является ответственностью `moderation`/`catalog_match_queue`, отдельного документа,
не логики ранжирования) — данный документ явно НЕ пытается алгоритмически «угадывать» дубли на
уровне поиска (риск ложного схлопывания РАЗНЫХ товаров перевешивает удобство).

**SRS-CAT-075** [Таймаут PostgreSQL при сложном композитном запросе] **[R1]** Given SQL-запрос §3.3
превышает `statement_timeout` (ASSUMPTION `2000 мс`, ENV `SEARCH_QUERY_TIMEOUT_MS`, конфигурируется
per-route через `pg` pool-опцию), When PostgreSQL прерывает запрос (`57014 query_canceled`), Then
`PostgresSearchProvider` перехватывает КОНКРЕТНО этот код (не generic catch), логирует
`pino.error({ query, radiusMeters, tenantId }, 'search_query_timeout')` и возвращает
`503 SERVICE_UNAVAILABLE details.reason='search_temporarily_degraded'` — НЕ `500 INTERNAL_ERROR`
(ожидаемая деградация под нагрузкой, не программная ошибка; клиент может повторить с более узким
радиусом — подсказка в `error.message`).

**SRS-CAT-076** [ElasticSearch недоступен, если `SEARCH_DRIVER=elasticsearch` включён в R2] **[R2]**
Given `ElasticSearchProvider` не может подключиться к кластеру (`ECONNREFUSED`/таймаут), When
`SearchMedicinesUseCase` вызывает порт, Then НЕ падает молча — `application`-обёртка
(`SearchProviderCircuitBreaker`, Charter §7 «circuit breaker») после `N` последовательных отказов
(ASSUMPTION 5) временно переключает трафик на `PostgresSearchProvider` как fallback (оба адаптера
реализуют идентичный интерфейс — переключение прозрачно для use case), с алертом в лог для
эксплуатации; автоматический возврат на Elasticsearch — при следующем успешном health-check
(`GET _cluster/health`).

**SRS-CAT-077** [Пустой результат поиска] **[R1]** Given ни `tsvector`, ни `pg_trgm`-фолбэк, ни
штрихкод-ветка не дали совпадений, Then ответ — `200` с `data: []`, `meta.pagination.hasMore: false`
(НЕ `404` — пустой список результатов является валидным, ожидаемым ответом поиска, не ошибкой
ресурса). UI показывает `catalog.search.no_results` С предложением проверить написание/расширить
радиус (не пустой белый экран).

**SRS-CAT-078** [Транслит даёт ложные совпадения] **[R1]** Given транслит-нормализация (SRS-CAT-024
п.3) породила вариант `q2`, который случайно совпадает триграммно с НЕСВЯЗАННЫМ по смыслу
медикаментом (короткие слова после транслитерации теряют различимость), When оба варианта (`q1`
исходный и `q2` транслитерированный) объединены `OR`, Then результаты обоих вариантов ранжируются
ОБЩЕЙ формулой §3 — `textRelevance`, вычисленный от `q1` (буквального ввода пользователя), обычно
выше для настоящего намерения, что естественным образом отодвигает ложные транслит-совпадения ниже
в списке, а не исключает их полностью (осознанный компромисс recall/precision — полное исключение
транслит-фолбэка вернуло бы персону «Биби Хосият», research 06 §8.3, к нулевым результатам).

---

## Тестовые сценарии

| TC | Проверяет | Given | When | Then |
|---|---|---|---|---|
| **TC-CAT-001** | CUJ-1, SRS-CAT-024/019 | `medicines.trade_name = 'Цитрамон'`, запрос `'цытрамон'` | `GET /medicines/search?text=цытрамон` | `Цитрамон` присутствует в `data[0..2]` (топ-3), `relevanceScore` вычислен через ветку 3 §3.2 (триграмма, без `tsvector`-хита) |
| **TC-CAT-002** | SRS-CAT-018 (полная формула) | Три медикамента с одинаковым `textRelevance=1.0`, разной ценой/дистанцией/наличием/надёжностью аптеки | `GET /medicines/search?text=парацетамол&geo=...` | Порядок результатов соответствует формуле §3.1 (unit-тест `RankingScoreMapper` без БД, подаёт зафиксированные входные величины, проверяет точное числовое совпадение с примером §3.2) |
| **TC-CAT-003** | SRS-CAT-022 (перенормировка без гео) | Тот же набор кандидатов, `geo` НЕ передан | `GET /medicines/search?text=парацетамол` (без `lat`/`lon`) | `proximityScore` отсутствует в расчёте, веса остальных компонент точно равны `{0.471, 0.235, 0.176, 0.118}` (±0.001 округление) |
| **TC-CAT-004** | SRS-CAT-024 п.2, штрихкод | `medicines.barcode = '4870123456789'` (валидный EAN-13) | `GET /medicines/search?text=4870123456789` | Ветка `searchByBarcode()` сработала (не обычный текстовый поиск), точное совпадение по `barcode`, `matchedVia` в логе = `'barcode'` |
| **TC-CAT-005** | SRS-CAT-024 п.2, штрихкод не найден | 13-значная строка, НЕ существующая в `medicines.barcode` | `GET /medicines/search?text=<13 цифр>` | `data: []`, НЕ выполнен фолбэк на триграммный текстовый поиск по 13-значной строке |
| **TC-CAT-006** | SRS-DB-014/015, TC-DB-012 воспроизводится на уровне use case | `trade_name` содержит `ӣ`, запрос содержит `и` вместо `ӣ` | `GET /medicines/search?text=...` (с `и`) | Совпадение найдено через `tajik_ru`-конфигурацию |
| **TC-CAT-007** | SRS-CAT-024 п.3, транслит | `trade_name = 'Калб'` (сердце, кириллица), запрос `'qalb'` (латиница) | `GET /medicines/search?text=qalb` | `TransliterationNormalizerService` производит вариант `'калб'`, находит совпадение через `OR`-объединение |
| **TC-CAT-008** | SRS-CAT-032/033 (форма НЕ совместима) | Медикамент A — `dosage_form_class='tablet'`, идентичное вещество+дозировка у медикамента B — `dosage_form_class='capsule'` | `GET /medicines/:idA/analogs` | B НЕ входит в список аналогов (диагональная матрица, §6.2) |
| **TC-CAT-009** | SRS-CAT-032 (сироп↔ампулы) | Медикамент A — `syrup`, медикамент B — `injection`, идентичное вещество+дозировка | `GET /medicines/:idA/analogs` | B НЕ входит в список |
| **TC-CAT-010** | **SRS-CAT-035 (обязательный regression, 500мг×2 vs 1000мг×1)** | Медикамент A — `tablet, 500 мг`; медикамент B — `tablet, 1000 мг`, то же вещество | `AnalogEquivalenceService.isAnalog(A, B)` (unit, без БД) | `false` — НЕ эквивалентны; тест явно проверяет, что суммарная кратность НЕ учитывается ни в каком виде |
| **TC-CAT-011** | SRS-CAT-034, конвертация единиц | Медикамент A — `500 mcg`; медикамент B — `0.5 mg`, то же вещество, та же форма | `AnalogEquivalenceService.isAnalog(A, B)` | `true` — эквивалентны после конвертации в базовую единицу массы (мкг) |
| **TC-CAT-012** | SRS-CAT-034, разные семейства единиц не конвертируются | Медикамент A — `10 mg`; медикамент B — `10 ml`, та же форма | `Dosage.isEquivalentTo()` | `false` — масса и объём не сравниваются между собой, независимо от числового совпадения |
| **TC-CAT-013** | SRS-CAT-036, расчёт экономии | Референсный товар `83.00 TJS`, самый дешёвый аналог в радиусе `18.00 TJS` | `GET /medicines/:id/analogs` | `savingsDiram = 6500` (не округлено), баннер показывает сумму `65,00` — **запятая**, десятичный разделитель таджикской локали. Исходный пример этой строки писался с точкой (`65.00`); точка воспроизводилась лишь потому, что внутренний код локали `tj` отсутствует в реестре BCP-47 и `Intl` молча откатывался на `en-US`. Тег исправлен на `tg` (`toIntlLocale`, `packages/i18n`), поэтому проверять следует отсутствие округления (суть REQ-MARKET-3), а не литеральный разделитель. Поправка CTO, волна 6, по спору исполнителя DTJ-104. |
| **TC-CAT-014** | SRS-CAT-037, экономии нет | Референсный товар — САМ самый дешёвый среди своих аналогов в радиусе | `GET /medicines/:id/analogs` | Блок «Сэкономьте» не рендерится, заголовок — нейтральный вариант, список аналогов всё ещё присутствует |
| **TC-CAT-015** | SRS-CAT-039, дисклеймер всегда виден | Любой валидный запрос блока аналогов, ≥1 результат | Рендер `AnalogsBlock` (компонентный тест) | Текст `catalog.analogs.disclaimer` присутствует в DOM НЕЗАВИСИМО от наличия/отсутствия плашки экономии |
| **TC-CAT-016** | SRS-CAT-040, Rx-бейдж на аналоге | Список аналогов содержит один OTC- и один Rx-вариант (разные производители) | Рендер блока | Rx-бейдж присутствует ТОЛЬКО у второй карточки, не у обеих и не как общий баннер |
| **TC-CAT-017** | SRS-CAT-006/SRS-DOM-157, скрытие narcotic | `medicine.controlCategory = 'narcotic'`, известен точный `id` | `GET /medicines/:id` анонимно/`customer` | `404 NOT_FOUND` (не `422`) |
| **TC-CAT-018** | SRS-CAT-056, `potent` заказываем, но без промо | `medicine.controlCategory = 'potent', isPrescriptionRequired=true` | `GET /medicines/search?text=...` | Товар присутствует в обычном поиске с Rx-бейджем; отсутствует в `GET /medicines/promoted` (если такой эндпоинт есть — по флагу `isPromotable=false`) |
| **TC-CAT-019** | SRS-CAT-010, невидимость `suspended`-сети | `pharmacy_chains.status = 'suspended'` для родительской сети единственной аптеки, несущей товар | `GET /medicines/search?text=...` | Товар НЕ появляется в результатах (условие 3, §1.4) — даже если сама `pharmacies.status` осталась `'active'` в устаревшем кэше |
| **TC-CAT-020** | SRS-CAT-046, «открыто сейчас» через полночь | `opening_time='20:00', closing_time='02:00'`, текущее время `Asia/Dushanbe = 01:00` | `GET /medicines/search?filters[openNowOnly]=true` | Аптека включена в результат (`isOpenNow=true`), формула перехода через полночь сработала корректно |
| **TC-CAT-021** | SRS-CAT-027/028/029, автодополнение и дедуп | `medicines` содержит 3 записи с `trade_name='Но-шпа'` (разные производители/дозировки) | `GET /medicines/suggest?q=но-ш` | Ровно ОДНА строка `«Но-шпа»` в ответе (дедуп по нормализованному имени), не три |
| **TC-CAT-022** | SRS-CAT-030, пустой ввод, история пуста | Новый браузер (пустой `localStorage`), `trending_searches` в Redis содержит 5 записей | `GET /medicines/suggest?q=` | Возвращены 5 популярных запросов из кэша, SQL-запрос к `medicines` НЕ выполнен |
| **TC-CAT-023** | SRS-CAT-018, приоритет ролей поиска — категория без текста | `filters.categoryId` задан, `text=''` | `GET /medicines/search?filters[categoryId]=5` | `sort` по умолчанию — `price_asc` (не `relevance`), `textRelevance=1.0` у всех кандидатов |
| **TC-CAT-024** | SRS-CAT-054, ограничение bbox | `bbox`, покрывающий площадь `> 2500 км²` | `GET /pharmacies/map?bbox=...` | `400 VALIDATION_ERROR details.field='bbox'` |
| **TC-CAT-025** | SRS-CAT-075, таймаут поискового запроса | Искусственно медленный запрос (интеграционный тест с `pg_sleep` внутри тестового представления) превышает `statement_timeout` | `GET /medicines/search?text=...` | `503 SERVICE_UNAVAILABLE details.reason='search_temporarily_degraded'`, залогирован `search_query_timeout` |
| **TC-CAT-026** | SRS-CAT-076 (R2), circuit breaker Elasticsearch | `SEARCH_DRIVER=elasticsearch`, кластер недоступен 5 попыток подряд | `GET /medicines/search` (6-й запрос) | Автоматический фолбэк на `PostgresSearchProvider`, ответ `200` с валидными результатами (не `503`) |
| **TC-CAT-027** | SRS-CAT-060, cache stampede | 20 параллельных идентичных запросов к одному и тому же поисковому ключу сразу после истечения TTL | Нагрузочный k6-сценарий | Ровно ОДИН реальный SQL-запрос выполнен к PostgreSQL (остальные 19 обслужены из кэша, записанного первым), проверяется по счётчику `pg_stat_statements` |
| **TC-CAT-028** | SRS-CAT-067, дефолт надёжности для новой аптеки | `pharmacy_reliability_scores` не содержит строки для `pharmacyId` (INSERT ещё не произошёл первой джобой) | Формула §3.3 (`COALESCE(prs.score, 3.5)`) | `reliabilityScore = 0.7` (`3.5/5`) применяется без ошибки `NULL` |
| **TC-CAT-029** | SRS-CAT-066/067, недостаточная выборка | Аптека с `totalProcessingOrders = 12` за 90 дней (`< 20`) | `RecomputePharmacyReliabilityJob` | `score` НЕ обновлён, остаётся предыдущее/дефолтное значение `3.50` |
| **TC-CAT-030** | SRS-DOM-158 (переиспользование, интеграционный) | Медикамент A `{парацетамол 500мг}` таблетки; медикамент B `{парацетамол 500мг, кофеин 50мг}` таблетки (частичное пересечение) | `GET /medicines/:idA/analogs` | B отсутствует — SQL-предфильтр (запрос 3, §6.6) отсеивает по неравенству кардинальности множества `substance_id` ДО применения `AnalogEquivalenceService` (двойная защита) |

---

**Итог**: документ вводит **78 требований `SRS-CAT-001..078`** и **30 тестовых сценариев
`TC-CAT-001..030`** поверх `10-domain-model.md` (`SRS-DOM-*`, в первую очередь §«Medicine»,
SRS-DOM-013..024/077..079/158..159), `11-database-schema.md` (`SRS-DB-*`, полнотекстовый поиск,
DDL `medicines`/`substances`/`categories`) и `12-api-conventions-auth-tenancy.md` (`SRS-API-*`,
конвенции пагинации/ошибок/тенантности, применённые к эндпоинтам `/medicines/*`,
`/categories`, `/pharmacies/map`). Все дополнения к схеме БД (`pharmacy_reliability_scores`,
`search_query_log`, `ix_medicines_trade_name_prefix`, `i18n_overrides.review_status`) явно
обоснованы требованиями выше и не переопределяют существующие таблицы/поля. Каждое требование
несёт метку релиза; подавляющее большинство — **R1** (движок аналогов и умный поиск признаны
владельцем продукта единственными защитимыми отличиями продукта, `04-SCOPE-DECISION-PIVOT.md`),
`ElasticSearchProvider` и circuit-breaker-фолбэк на него — **R2** (не заблокировано, но не нужно
для узкого объёма R1).
