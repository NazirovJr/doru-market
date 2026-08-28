# EP-04 / EP-07 — Модель каталога и Analog Engine

> Владелец: Tech Lead зоны «Каталог + Аналоги». Диапазон ID: **DTJ-090..DTJ-139** (использовано
> `DTJ-090..DTJ-104`, 15 тикетов). Источники (по убыванию приоритета) — см. `docs/04-SCOPE-DECISION-
> PIVOT.md` → `docs/03-ARCHITECT-DECISIONS.md` → `docs/02-CLEAN-ARCHITECTURE-AND-CODE.md` →
> `docs/01-TECH-BASELINE.md` → `docs/00-PROJECT-CHARTER.md` → `docs/spec/*.md` → `tz.log`.
>
> Покрывает `docs/spec/20-module-catalog-search.md` §1 (модель каталога), §6 (Analog Engine), §13
> (`CatalogFacade`), §14.4 (i18n-статус дисклеймера) и `docs/spec/22-module-inventory-sync-1c.md` §4
> в части, реализуемой на стороне `catalog` (composite-матчинг, D-06). Разделы §2-5, §7-12, §14.1-14.3
> документа `20-module-catalog-search.md` (поиск, ранжирование, автодополнение, карта, кэш поиска) —
> **не в этой зоне**, принадлежат EP-06/EP-08.

## Состав

| Эпик | Название | Тикеты |
|---|---|---|
| EP-04 | Модель каталога | DTJ-090 .. DTJ-098 |
| EP-07 | Analog Engine | DTJ-099 .. DTJ-104 |

## Порядок выполнения и зависимости

```
DTJ-090 (скаффолдинг catalog + packages/domain-kernel: Dosage/DosageForm/Barcode)
   │
   ├──▶ DTJ-091 (DDL: categories/substances/medicines/medicine_substances + enum'ы)
   │        │
   │        ├──▶ DTJ-092 (CatalogRepository: порт + Drizzle-адаптер)
   │        │        │
   │        │        ├──▶ DTJ-093 (Medicine entity + инварианты + publish()/proposeControlCategory())
   │        │        │        │
   │        │        │        ├──▶ DTJ-094 (CategoryTreeService + GET /categories)
   │        │        │        ├──▶ DTJ-096 (CatalogFacade: getMedicineSnapshot/getSubstances/isVisible)
   │        │        │        │        │
   │        │        │        │        └──▶ DTJ-097 (resolveMedicineByComposite, D-06)
   │        │        │        │
   │        │        │        ├──▶ DTJ-098 (seed ≥300 позиций, D-13)
   │        │        │        │
   │        │        │        └──▶ DTJ-099 (AnalogEquivalenceService, домен)
   │        │        │
   │        │        └──▶ DTJ-100 (AnalogCandidatesRepository, SQL-предфильтр top-50)
   │        │
   │        └──▶ DTJ-103 (i18n-контент аналогов + i18n_overrides.review_status)
   │
   └──▶ (использует VO из DTJ-090 напрямую) DTJ-099

DTJ-096 + DTJ-099 + DTJ-100 ──▶ DTJ-101 (FindAnalogsUseCase + AnalogOfferLookupPort)
                                    │
DTJ-101 + DTJ-103 ─────────────────┴──▶ DTJ-102 (GET /medicines/:id/analogs, контроллер)
                                              │
DTJ-102 + DTJ-103 ────────────────────────────▶ DTJ-104 (Frontend AnalogsBlock)

DTJ-092 + DTJ-093 + DTJ-101 ──▶ DTJ-095 (GetMedicineDetailUseCase + GET /medicines/:id,
                                          hasAnalogs зависит от FindAnalogsUseCase)
```

**Рекомендованный порядок реализации одним потоком** (минимизирует ожидание блокирующих
зависимостей): `090 → 091 → 092 → 093 → 094 → 096 → 097 → 098 → 099 → 100 → 101 → 095 → 102 → 103 →
104`. Тикет `103` (i18n-контент) не имеет тяжёлых зависимостей внутри эпика (только `091`) и может
выполняться параллельно в любой момент после DDL — сдвинут в конец списка только по смысловой
близости к `102`/`104`, фактическая жёсткая зависимость только от `091`.

## Ключевые архитектурные решения этой зоны (см. подробности в теле тикетов)

1. **`packages/domain-kernel`** (DTJ-090) — новый shared-пакет для VO `Dosage`/`DosageForm`/`Barcode`,
   переиспользуемых модулем `inventory` (EP-05) для composite-матчинга, БЕЗ прямого импорта
   `catalog/domain/*` (запрещено `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1). Ни один эпик явно не
   владеет таким пакетом в `docs/tickets/00-EPICS.md` — заведён здесь как первый реальный потребитель,
   с явным риском дублирования, если EP-01 параллельно создаст аналогичный пакет под другим именем
   (см. «Риски» DTJ-090).
2. **Analog Engine физически живёт внутри `modules/catalog/**`**, а НЕ в отдельном
   `modules/analogs/**`, как намечено файловой таблицей `tickets/00-EPICS.md`. Причина: `docs/spec/
   20-module-catalog-search.md` SRS-CAT-042 явно размещает `AnalogEquivalenceService`/
   `FindAnalogsUseCase` внутри `modules/catalog/domain|application/*`, и `02-CLEAN-ARCHITECTURE-AND-
   CODE.md` §1.1 запрещает `modules/analogs` импортировать `modules/catalog/domain|application`
   напрямую — отдельный модуль потребовал бы либо нарушения границ, либо раздутого `CatalogFacade`,
   отдающего сырые доменные сущности наружу (тоже запрещено, §1.2). Поскольку `tickets/00-EPICS.md` не
   входит в официальную иерархию документов конфликт-резолюции (см. системную инструкцию тимлида), а
   `docs/spec/20-module-catalog-search.md` в неё входит — решение принято в пользу спецификации.
   `apps/web/src/features/analogs/**` остаётся отдельной фронтенд-фичей (оба документа согласны).
3. **`AnalogOfferLookupPort`** (DTJ-101) — единственное место эпика, которому требуется межконтекстное
   чтение (`inventory` + `onboarding`) на уровне, аналогичном исключению `SRS-CAT-014` для
   `PostgresSearchProvider` (EP-06), но НЕ покрытом этим исключением дословно. Тикет требует ADR
   архитектора до мержа прямого SQL-варианта; fallback — facade-оркестрация. Это самый рискованный
   тикет диапазона — см. его «Риски» перед стартом реализации.

## Пересечения с другими эпиками (файлы вне этого диапазона, только для координации)

- **EP-05 (inventory)** — потребитель `packages/domain-kernel` (Barcode/Dosage) и
  `CatalogFacade.resolveMedicineByComposite()` (DTJ-096/097). Типы `CompositeMatchInput`/
  `MedicineMatchResult` зафиксированы в `packages/contracts/src/catalog.ts` этим эпиком (DTJ-097) —
  владелец EP-05 обязан свериться с их формой ДО начала `CompositeInventoryMatcherService`.
- **EP-06 (поиск)** — потребитель `medicines`/`substances`/`categories` (только чтение, через
  `PostgresSearchProvider`, собственная миграция GIN/trgm-индексов, не входящая в DTJ-091). Также
  владеет `SEARCH_DEFAULT_RADIUS_METERS`/`PharmacyOffer`-типом в `packages/contracts/src/search.ts`,
  переиспользуемым DTJ-101/DTJ-102 (координация по имени экспорта).
- **EP-01 (фундамент)** — может уже владеть общим VO-пакетом (`Money`/`PhoneNumber`/`GeoPoint`/
  `TenantId`/`OtpCode`) и базовым классом `DomainError` — сверить перед стартом DTJ-090/093.
- **EP-19 (CI/DevOps)** — единственный владелец `.dependency-cruiser.cjs`; ADR-исключение из DTJ-101
  вносится ИМИ по результату согласования, не этим эпиком напрямую.

## Пропущенные/отсутствующие SRS-ссылки

Все цитируемые в тикетах `SRS-CAT-*`/`SRS-DOM-*`/`SRS-DB-*`/`SRS-API-*`/`SRS-INV-*` идентификаторы
реально найдены в `docs/spec/`. Отсутствующих (выдуманных) идентификаторов нет. Единственный
содержательный пробел — методы `InventoryFacade`/`OnboardingFacade`, нужные `DTJ-101` в качестве
fallback-пути, НЕ задокументированы ни в одном спек-документе явной сигнатурой (см. «Риски» DTJ-101).
