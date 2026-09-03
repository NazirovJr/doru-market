# Бриф CTO на волну EP-11/EP-14 (возвраты + облегчённая поддержка)

> ⛔ **ЗАМОРОЖЕН до волны 8.** Решением CTO от 02.09.2026 эпики EP-11/EP-14 не начинаются:
> они стоят в волнах 8 и 10, проект на волне 4, а предмет возвратов (`orders`,
> `escrow_ledger`, персистентный склад) физически отсутствует. Основания и что строим
> вместо — `reports/CTO-DECISION-WAVE5.md`. Восемь снятых ниже блокеров остаются в силе
> и действительны на момент, когда очередь дойдёт.

> Составил: CTO. Дата: 02.09.2026. Ветка `master`.
> Адресат: исполнители тикетов `tickets/ep07-returns-disputes/DTJ-270..284`.
> Статус: решения ниже — **закрытые** (`CLAUDE-CTO.md` §2). Не переоткрывать молча,
> несогласие — через §6 «Разногласия», в поле `disputed` отчёта.

Читать в порядке: этот файл → `tickets/ep07-returns-disputes/README.md` → свой тикет →
`AGENTS.md` → `docs/05-DEVELOPER-HANDBOOK.md` §5, §8, §17.

---

## 1. Что уже проверено CTO — не перепроверять, не «уточнять»

Прогнано лично 02.09.2026, результаты действительны на коммит `5a1a6f2` + рабочее дерево:

| Факт | Значение |
|---|---|
| Следующий свободный номер миграции | **0023** (последняя применённая — `0022_pharmacies_lat_lon_index`) |
| Enum'ы группы F в БД | **отсутствуют все семь** — создаёт их DTJ-270 |
| Таблица `orders` (группа D, EP-09) | **не существует**, эпик не начат |
| Таблица `payout_schedule` (группа E, EP-10) | **не существует**, эпик не начат |
| Таблицы `users`, `tenants` | существуют, FK на них создавать нормально |
| Раннер миграций | `apps/api/src/infrastructure/database/migrate.ts`, drizzle + `meta/_journal.json` |
| Тестовая БД | `postgres://test:test@localhost:5432/dorutj_test` (контейнер `docker-postgres-1`) |
| Redis | `redis://:dorutj_dev_redis_password@localhost:6379` — **пароль обязателен**, без него поиск падает 500 |

Гейты на входе в волну зелёные (проверено прогоном, не отчётом): `typecheck` 14/14,
`lint` 0, `arch:check` 0 нарушений, `apps/api` 1123 unit + 95 integration.
**Любое красное после твоей работы — твой регресс.**

---

## 2. Решения CTO по блокерам этой волны

### D-EP11-1. FK на несуществующие таблицы — отложенный `ALTER`, а не создание чужих таблиц

**Проблема.** Канонический DDL (`11-database-schema.md` строки 921–1027) связывает
`order_returns`, `support_tickets`, `order_disputes` с `orders(id)`, а также требует
`ALTER TABLE payout_schedule ADD CONSTRAINT fk_payout_schedule_dispute`. Ни `orders`, ни
`payout_schedule` не существуют — их эпики (EP-09/EP-10) не начаты. Миграция в буквальном
виде не применится.

**Решение.** Колонки создаются с правильным типом и семантикой (`order_id UUID NOT NULL`),
но **без** `REFERENCES`. Сами FK выносятся в конец файла миграции отдельным
закомментированным разделом `-- ОТЛОЖЕНО` в виде готовых `ALTER TABLE` с маркерами
`TODO(DTJ-220)` (группа D, `orders`), `TODO(DTJ-236)` (группа E, `payout_schedule`),
`TODO(DTJ-313)` (группа H, `couriers`). Владелец соответствующей группы переносит их
в свою миграцию.

**Основание.** Это не изобретение: сам канонический DDL применяет ровно этот приём к
`order_returns.courier_id` — «FK добавлен ALTER TABLE после CREATE TABLE couriers
(группа H)». Группы создаются в порядке зависимостей, forward-ссылки доигрываются.
Альтернатива — создать `orders` здесь — нарушает владение файлами: `orders` принадлежит
EP-09 (`tickets/00-EPICS.md`).

**Что это значит для приёмки.** Отсутствие этих трёх FK — **не дефект** и не повод
занижать оценку. Дефект — если исполнитель молча создаст `orders` или молча выбросит
колонку.

### D-EP11-2. Номер миграции — `0023_returns_disputes_support.sql`

DTJ-270 называет файл `0010_returns_disputes_support.sql` и сам предписывает сверить
номер с фактическим состоянием каталога. Сверено: `0010` занят
(`0010_otp_purpose_add_onboarding_contact.sql`). Использовать **0023**, добавить парный
`.down.sql` и **одну** запись в `meta/_journal.json` (`idx: 26`).

### D-EP11-3. `pgEnum` — в существующий `enums.schema.ts`, новый файл не заводить

`apps/api/src/db/schema/enums.schema.ts` — общий файл всех `pgEnum` проекта, его
собственный JSDoc предписывает: «Дописывайте свои `pgEnum(...)` В ЭТОТ ФАЙЛ, не создавайте
отдельный». Файл только растёт вниз (D-27, правится добавлением строк). Все семь enum'ов
группы F — туда, в конец.

### D-EP11-4. `returned_to_pharmacy` — в типе есть, перехода в R1 нет

Канонический `return_status` содержит пять значений, включая `returned_to_pharmacy`.
Машина состояний DTJ-271 ведёт `return_in_transit` сразу в `return_confirmed`/
`return_rejected` (приёмка и решение о restock — один шаг `confirmReceived()`).

**Решение:** значение включается в `pgEnum` и в тип контрактов (схема БД — ЗАКОН,
SRS-DB-008, список не урезается), но **ни один переход R1 в него не ведёт**. Пометить
`TODO(DTJ-273)`: если use case разделит «товар доехал» и «фармацевт принял» на два шага,
статус войдёт в таблицу переходов без изменения enum'а.

### D-EP11-5. Новый код ошибки `UNSUPPORTED_RETURN_REASON` — разрешаю добавить

DTJ-271 требует `UnsupportedReturnReasonError` (причина `undelivered` ведёт в поддержку,
а не в возврат — SRS-RET-003). Подходящего кода в `packages/contracts/src/errors.ts` нет.

**Решение:** добавить `UNSUPPORTED_RETURN_REASON = 'UNSUPPORTED_RETURN_REASON'` в блок
`BusinessRuleViolationError` enum'а `ErrorCode` и строку `422` в `ERROR_HTTP_STATUS`.
Это barrel-файл (D-27) — **только добавление двух строк**, ничего не переписывать.
Обобщённый `BUSINESS_RULE_VIOLATION` не годится: клиенту нужно отличить «эта причина
обслуживается другим процессом» от прочих отказов.

### D-EP11-7. Номер миграции DTJ-278 — `0024_support_ticket_sla_fields.sql`

Та же болезнь, что D-EP11-2: DTJ-278 называет файл `0011_support_ticket_sla_fields.sql`,
но `0011` занят (`0011_pharmacy_chains_add_contact_phone_verified.sql`). Использовать
**0024** (после `0023` из DTJ-270), парный `.down.sql`, запись `idx: 27` в журнале.

Эта миграция применяется **после** 0023 и зависит от неё (`ALTER TABLE support_tickets`) —
исполнитель DTJ-278 не начинает, пока DTJ-270 не сдан и не принят.

### D-EP11-8. `OrdersFacade` не существует — порт со стаб-адаптером, не выдуманный фасад

`SupportOrdersFacadePort.belongsToCustomer()` (DTJ-279) и все четыре порта DTJ-270
(`orders`/`payments`/`inventory`/`delivery`) описывают модули, которых нет: EP-09 и EP-10
не начаты, `delivery` (EP-13) тоже.

**Решение** (правило 10 `AGENTS.md`, «зависишь от несделанного тикета — застаб порт
null-адаптером с TODO и ссылкой на тикет»): объявляется **интерфейс порта** (это и есть
работа DTJ-270/279), а регистрируемая в модуле реализация — явный стаб, который бросает
или возвращает безопасное значение с маркером `TODO(DTJ-222)` для `OrdersFacade`,
`TODO(DTJ-241)` для платежей, `TODO(DTJ-314)` для `DeliveryFacade`.

**Запрещено:** выдумывать интерфейс чужого фасада «как будет удобно» и тем более создавать
файлы в `apps/api/src/modules/orders/**` или `modules/payments/**` — это чужой `files_owned`.
Сигнатуры сверяются владельцем EP-09/EP-10 на этапе реализации потребляющей стороны
(README эпика, раздел «Межэпиковые контракты»).

**Проверить перед стартом DTJ-279:** существует ли `TenantSettingsPort` в кодовой базе
(`grep -rn "TenantSettings" apps/api/src --include=*.ts`). Если нет — это ещё один стаб
с `TODO`, а не повод останавливаться.

### D-EP11-6. Объём EP-14 в R1 — только `support_tickets`

Подтверждаю разрешение конфликта источников из README эпика: `order_disputes` и
`dispute_status_history` заводятся **схемой** (правило «ретрофит дороже», SRS-ADM-001),
но домена, use case'ов и эндпоинтов поверх них в этом диапазоне тикетов **нет**. Полный
воркфлоу спора — R2/R3 за флагом `disputes_workflow_enabled`. Расхождение с §8
`21-module-orders-payments-escrow.md` — ожидаемо и осознанно.

---

## 3. Ловушки кодовой базы — проверено, сэкономит вам час каждому

Волна 3.5 уже породила **две живые копии** `Barcode` и `Dosage` (см.
`docs/07-WAVE4-HANDOFF.md` §4.1) — оба чинятся дважды. Не создайте третью пару.

| Что нужно | Где ОНО УЖЕ ЕСТЬ | Чего НЕ делать |
|---|---|---|
| `Money` VO (дирамы, `>= 0`) | `apps/api/src/shared-kernel/domain/value-objects/money.vo.ts` | **DTJ-271 п.7 врёт**, что `Money` в `packages/contracts` — его там нет. Не заводить свой |
| `Result<T,E>`, `ok`, `err` | `packages/domain-kernel/src/common/result.ts`, реэкспорт из `@dorutj/domain-kernel` | не писать свой Result |
| `Clock` | **две копии**: `shared-kernel/application/ports/clock.port.ts` и `modules/catalog/application/ports/clock.port.ts`. Для нового модуля брать **shared-kernel** | не заводить третью |
| `DomainError` (база) | **две копии**: `packages/contracts/src/domain-error-base.ts` (с `ErrorCode`) и `packages/domain-kernel/.../dosage.errors.ts`. Брать **contracts** | не заводить третью |
| Коды ошибок возвратов | уже есть в `errors.ts`: `RETURN_ALREADY_ACTIVE` (409), `RESTOCK_CONDITIONS_NOT_MET` (422), `CONTROLLED_SUBSTANCE_MUST_BE_DESTROYED` (422), `INVALID_STATE_TRANSITION` (409), `MISSING_RESOLUTION_REASON` (400) | не плодить синонимы |
| Образец сущности с таблицей переходов | `apps/api/src/modules/inventory/domain/inventory-sync-batch.entity.ts` (`ALLOWED_TRANSITIONS`) | не изобретать свой стиль |
| Образец миграции с идемпотентным enum | `apps/api/migrations/0002_enums.sql` (`DO $$ ... EXCEPTION WHEN duplicate_object`) | не писать голый `CREATE TYPE` |

**Про `@Optional()` в конструкторах.** Гейт `tests/arch/di-explicit-inject.spec.ts` ловит
параметр со значением по умолчанию без `@Optional()`: `tsc` эмитит `design:paramtypes`, и
Nest ищет провайдера для `Array`. Собранное приложение падает при зелёных unit-тестах.
Это уже стоило волне 4 одного разбора — см. `docs/07-WAVE4-HANDOFF.md` §3.1.

---

## 4. Порядок работ

```
Шаг 1  DTJ-270  скаффолдинг (миграция, схема, порты, каркасы модулей, контракты)
          │  единая точка синхронизации — обе ветки ждут его
          ├──────────────────────┬──────────────────────┐
          ▼                      ▼                      │
Шаг 2а DTJ-271 → DTJ-272    Шаг 2б DTJ-278 → DTJ-279    │  параллельно
       домен OrderReturn           домен SupportTicket   │
       + финансовая политика       + CreateUseCase       │
          └──────────────────────┴──────────────────────┘
          ▼
Шаг 3  независимое ревью (не автор кода)
          ▼
Шаг 4  приёмка CTO — прогон команд, не чтение отчёта
```

**За DTJ-272/279 в этой волне не выходить.** DTJ-273+ требует фасадов `orders`/`payments`
и приложения `apps/pharmacy`, которых нет; DTJ-275+ — REST поверх них. Правило 7
`AGENTS.md`: «Однажды здесь начали эпик из волны 6 и не закончили».

---

## 5. Обязательное перед сдачей

```bash
pnpm verify
```

Плюс то, чего `verify` не покрывает:

```bash
cd apps/api && DATABASE_URL='postgres://test:test@localhost:5432/dorutj_test' npx tsx src/infrastructure/database/migrate.ts
```

Прогнать **дважды подряд** — миграция обязана быть идемпотентной (критерий приёмки 4
DTJ-270). Затем проверить структуру фактически, а не по своему SQL:

```bash
docker exec docker-postgres-1 psql -U test -d dorutj_test -c "\d order_returns"
```

Интеграционный набор `apps/api` гонять тоже дважды — неидемпотентная фикстура вылезает
на втором прогоне.

## 6. Формат сдачи

По `AGENTS.md`: что сделано, `assumptions`, `blockers`, `foundIssues`, `disputed`,
`needsDependency`. **Формулировки «эпик закрыт», «волна готова» — превышение полномочий**
(`CLAUDE-CTO.md` §3). Исполнитель пишет «сдаю на приёмку, проверки такие-то, не сделано
то-то». Вердикт выношу я.
