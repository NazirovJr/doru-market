# DoruTJ — Решения архитектора по итогам исследования (Architect Rulings)

> Владелец: Architect / PM. Статус: **BASELINE v1.0, ОБЯЗАТЕЛЕН.**
> Вход: `docs/product/research/00-RESEARCH-DIGEST.md` (202 требования, 13 конфликтов, 16 открытых вопросов).
> Назначение: снять ВСЕ блокеры перед фазой Analysis/SRS. Аналитик не имеет права переоткрывать
> решение из этого документа — только предложить ADR с обоснованием.
> Приоритет источников при противоречии: **этот документ > Charter > research > `docs/product/client-brief-original.txt`**.

## Индекс решений

Один файл — одно решение. Принятое решение не редактируется: изменение оформляется новым решением со ссылкой «заменяет D-NN».

| ID | Решение | Статус | Файл |
|---|---|---|---|
| D-01 | Бренд «DoruTJ» vs существующий `doru.tj` — НЕ БЛОКИРУЕТ РАЗРАБОТКУ | принято | [d-01-brand-in-config.md](d-01-brand-in-config.md) |
| D-02 | Escrow — программный ledger, а не банковский hold/capture | принято | [d-02-escrow-programmatic-ledger.md](d-02-escrow-programmatic-ledger.md) |
| D-03 | Комиссия платформы отсутствовала в схеме | принято | [d-03-platform-commission.md](d-03-platform-commission.md) |
| D-04 | SLA дельта-синхронизации: 3 мин (ТЗ) vs 15 мин (отрасль) | принято | [d-04-sync-sla.md](d-04-sync-sla.md) |
| D-05 | Пропускная способность: 5 000 событий/сек (ТЗ) vs ~56 расчётных | принято | [d-05-throughput.md](d-05-throughput.md) |
| D-06 | Матчинг товара по штрихкоду ненадёжен | принято | [d-06-barcode-matching.md](d-06-barcode-matching.md) |
| D-07 | Комбинированные препараты не укладываются в `inn_name` (одно поле) | принято | [d-07-combination-drugs-substances.md](d-07-combination-drugs-substances.md) |
| D-08 | Отсутствует `control_category` (нарушение закона РТ) | принято | [d-08-control-category.md](d-08-control-category.md) |
| D-09 | Возвраты не описаны в ТЗ вовсе | принято | [d-09-returns.md](d-09-returns.md) |
| D-10 | Частичный рефанд не поддерживается платёжным провайдером | принято | [d-10-partial-refund.md](d-10-partial-refund.md) |
| D-11 | 1С-шлюз: обязательный mTLS (ТЗ) vs API-ключ (research) | принято | [d-11-gateway-1c-auth.md](d-11-gateway-1c-auth.md) |
| D-12 | Каналы поступления остатков | принято | [d-12-inventory-channels.md](d-12-inventory-channels.md) |
| D-13 | Каталог 8 000+ позиций за Спринт 2 — нереалистично | принято | [d-13-catalog-size.md](d-13-catalog-size.md) |
| D-14 | Порог confidence OCR | принято как рабочий дефолт (ASSUMPTION) | [d-14-ocr-confidence.md](d-14-ocr-confidence.md) |
| D-15 | STT для таджикского | принято как рабочий дефолт (ASSUMPTION) | [d-15-stt-tajik.md](d-15-stt-tajik.md) |
| D-16 | Оплата наличными (COD) | принято как рабочий дефолт (ASSUMPTION) | [d-16-cash-on-delivery.md](d-16-cash-on-delivery.md) |
| D-17 | Юридическая модель | принято как рабочий дефолт (ASSUMPTION) | [d-17-legal-model.md](d-17-legal-model.md) |
| D-18 | Фискализация | принято как рабочий дефолт (ASSUMPTION) | [d-18-fiscalization.md](d-18-fiscalization.md) |
| D-19 | SLA и окна | принято как рабочий дефолт (ASSUMPTION) | [d-19-sla-windows.md](d-19-sla-windows.md) |
| D-20 | Цифры рынка | принято как рабочий дефолт (ASSUMPTION) | [d-20-market-figures.md](d-20-market-figures.md) |
| D-21 | Компенсация курьера | принято как рабочий дефолт (ASSUMPTION) | [d-21-courier-compensation.md](d-21-courier-compensation.md) |
| D-22 | Онбординг аптеки | принято как рабочий дефолт (ASSUMPTION) | [d-22-pharmacy-onboarding.md](d-22-pharmacy-onboarding.md) |
| D-23 | Канал уведомлений | принято как рабочий дефолт (ASSUMPTION) | [d-23-notification-channel.md](d-23-notification-channel.md) |
| D-24 | Спор/поддержка | принято как рабочий дефолт (ASSUMPTION) | [d-24-disputes-support.md](d-24-disputes-support.md) |
| D-25 | Оплата наличными не имеет права называться `paid_escrow` — вводится статус `confirmed` | принято (пересмотрено 27.08.2026) | [d-25-cash-not-paid-escrow.md](d-25-cash-not-paid-escrow.md) |
| D-26 | Расхождения принятого дизайна и SRS — разрешение | принято | [d-26-design-spec-divergences.md](d-26-design-spec-divergences.md) |
| D-27 | Протокол владения файлами при параллельной разработке | принято | [d-27-file-ownership-protocol.md](d-27-file-ownership-protocol.md) |

### Решения CTO волн (тексты остались в архиве, не перенесены)

| ID | Решение | Статус | Где |
|---|---|---|---|
| D-EP09-1 | Номер миграции — `0023_orders_cart.sql` | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-1-номер-миграции--0023_orders_cartsql) |
| D-EP09-2 | `order_status` создаётся здесь, целиком, сразу с `confirmed` | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-2-order_status-создаётся-здесь-целиком-сразу-с-confirmed) |
| D-EP09-3 | FK на несуществующие таблицы — отложенным `ALTER`, раздел «ОТЛОЖЕНО» | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-3-fk-на-несуществующие-таблицы--отложенным-alter-раздел-отложено) |
| D-EP09-4 | `idempotency_keys` СУЩЕСТВУЕТ — общий интерсептор, локальный механизм запрещён | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-4-idempotency_keys-существует--общий-интерсептор-локальный-механизм-запрещён) |
| D-EP09-5 | Настройки тенанта: часть есть, часть хардкодится с `TODO` | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-5-настройки-тенанта-часть-есть-часть-хардкодится-с-todo) |
| D-EP09-6 | `inventory_batches` не существует — FK на `pharmacy_inventory(id)` | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-6-inventory_batches-не-существует--fk-на-pharmacy_inventoryid) |
| D-EP09-7 | Поправка к D-EP09-3: `handover_otp_id` получает FK сразу | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-7-поправка-к-d-ep09-3-handover_otp_id-получает-fk-сразу) |
| D-EP09-8 | Маркер для `prescription_id` — `TODO(R2-4)` | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-8-маркер-для-prescription_id--todor2-4) |
| D-EP09-9 | `ORDER_PHARMACY_MISMATCH` — дополнена спека, затем фикстура | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-9-order_pharmacy_mismatch--дополнена-спека-затем-фикстура) |
| D-EP09-10 | Репозитории `orders`: `tenantId` — первый обязательный параметр | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-10-репозитории-orders-tenantid--первый-обязательный-параметр) |
| D-EP09-11 | Null-адаптер порта: чтение может возвращать пусто, запись обязана бросать | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-11-null-адаптер-порта-чтение-может-возвращать-пусто-запись-обязана-бросать) |
| D-EP09-12 | ADR по SRS-ORD-005 (мягкий резерв) — УТВЕРЖДЁН, с четырьмя условиями | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-12-adr-по-srs-ord-005-мягкий-резерв--утверждён-с-четырьмя-условиями) |
| D-EP09-13 | `cart.updated_at` не обновляется ничем — джоба очистки удаляла бы живые корзины | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-13-cartupdated_at-не-обновляется-ничем--джоба-очистки-удаляла-бы-живые-корзины) |
| D-EP09-14 | Testcontainers не использовать — пакета в проекте нет | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-14-testcontainers-не-использовать--пакета-в-проекте-нет) |
| D-EP09-15 | Джоба hard delete — защитить от неверного конфига | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-15-джоба-hard-delete--защитить-от-неверного-конфига) |
| D-EP09-16 | Заглушка, отвечающая на вопрос о допустимости, обязана бросать | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-16-заглушка-отвечающая-на-вопрос-о-допустимости-обязана-бросать) |
| D-EP09-17 | Синхронный `PaymentInvoicePort.createInvoice` после commit — подтверждён | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-17-синхронный-paymentinvoiceportcreateinvoice-после-commit--подтверждён) |
| D-EP09-18 | Идемпотентность checkout сидит на in-memory — заменить в DTJ-227 | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-18-идемпотентность-checkout-сидит-на-in-memory--заменить-в-dtj-227) |
| D-EP09-19 | DTJ-227 снимает все четыре null-адаптера | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-19-dtj-227-снимает-все-четыре-null-адаптера) |
| D-EP09-21 | `UnitOfWork` для orders — свой порт, транзакция на группу | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-21-unitofwork-для-orders--свой-порт-транзакция-на-группу) |
| D-EP09-22 | Корзину не создаёт никто — завести резолвинг в DTJ-226 | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-22-корзину-не-создаёт-никто--завести-резолвинг-в-dtj-226) |
| D-EP09-23 | `session_token` — учётные данные, а не идентификатор | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-23-session_token--учётные-данные-а-не-идентификатор) |
| D-EP09-24 | Тенант читает только presentation | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-24-тенант-читает-только-presentation) |
| D-EP09-27..31 | Решения по DTJ-232 (`CancelOrderUseCase`) | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-2731-решения-по-dtj-232-cancelorderusecase) |
| D-EP09-32 | Номер миграции DTJ-228 — `0024`, а не `0020` | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-32-номер-миграции-dtj-228--0024-а-не-0020) |
| D-EP09-33 | ADR по `orders.billing_strategy` (DTJ-228) — УТВЕРЖДЁН, с одним условием | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-33-adr-по-ordersbilling_strategy-dtj-228--утверждён-с-одним-условием) |
| D-EP09-34 | Банковское округление уже реализовано — не писать второе | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-34-банковское-округление-уже-реализовано--не-писать-второе) |
| D-EP09-35 | DTJ-230: assertion'ы D-25 — программная ошибка, не бизнес-ошибка | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-35-dtj-230-assertionы-d-25--программная-ошибка-не-бизнес-ошибка) |
| D-EP09-36 | Токен гостевой корзины: клиентское значение НИКОГДА не создаёт корзину | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-36-токен-гостевой-корзины-клиентское-значение-никогда-не-создаёт-корзину) |
| D-EP09-37 | Уникальность корзины перенесена в схему (`0026`) | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-37-уникальность-корзины-перенесена-в-схему-0026) |
| D-EP09-38 | В приложении был ОДИН работающий фильтр ошибок из трёх зарегистрированных | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-38-в-приложении-был-один-работающий-фильтр-ошибок-из-трёх-зарегистрированных) |
| D-EP09-39 | D-25 защищён на уровне схемы (`0027`) | принято (бриф волны 6, EP-09) | [ep09-cto-brief.md](../../history/briefs/ep09-cto-brief.md#d-ep09-39-d-25-защищён-на-уровне-схемы-0027) |
| D-EP11-1 | FK на несуществующие таблицы — отложенный `ALTER`, а не создание чужих таблиц | принято (бриф EP-11/EP-14, заморожен до волны 8) | [ep11-ep14-cto-brief.md](../../history/briefs/ep11-ep14-cto-brief.md#d-ep11-1-fk-на-несуществующие-таблицы--отложенный-alter-а-не-создание-чужих-таблиц) |
| D-EP11-2 | Номер миграции — `0023_returns_disputes_support.sql` | принято (бриф EP-11/EP-14, заморожен до волны 8) | [ep11-ep14-cto-brief.md](../../history/briefs/ep11-ep14-cto-brief.md#d-ep11-2-номер-миграции--0023_returns_disputes_supportsql) |
| D-EP11-3 | `pgEnum` — в существующий `enums.schema.ts`, новый файл не заводить | принято (бриф EP-11/EP-14, заморожен до волны 8) | [ep11-ep14-cto-brief.md](../../history/briefs/ep11-ep14-cto-brief.md#d-ep11-3-pgenum--в-существующий-enumsschemats-новый-файл-не-заводить) |
| D-EP11-4 | `returned_to_pharmacy` — в типе есть, перехода в R1 нет | принято (бриф EP-11/EP-14, заморожен до волны 8) | [ep11-ep14-cto-brief.md](../../history/briefs/ep11-ep14-cto-brief.md#d-ep11-4-returned_to_pharmacy--в-типе-есть-перехода-в-r1-нет) |
| D-EP11-5 | Новый код ошибки `UNSUPPORTED_RETURN_REASON` — разрешаю добавить | принято (бриф EP-11/EP-14, заморожен до волны 8) | [ep11-ep14-cto-brief.md](../../history/briefs/ep11-ep14-cto-brief.md#d-ep11-5-новый-код-ошибки-unsupported_return_reason--разрешаю-добавить) |
| D-EP11-7 | Номер миграции DTJ-278 — `0024_support_ticket_sla_fields.sql` | принято (бриф EP-11/EP-14, заморожен до волны 8) | [ep11-ep14-cto-brief.md](../../history/briefs/ep11-ep14-cto-brief.md#d-ep11-7-номер-миграции-dtj-278--0024_support_ticket_sla_fieldssql) |
| D-EP11-8 | `OrdersFacade` не существует — порт со стаб-адаптером, не выдуманный фасад | принято (бриф EP-11/EP-14, заморожен до волны 8) | [ep11-ep14-cto-brief.md](../../history/briefs/ep11-ep14-cto-brief.md#d-ep11-8-ordersfacade-не-существует--порт-со-стаб-адаптером-не-выдуманный-фасад) |
| D-EP11-6 | Объём EP-14 в R1 — только `support_tickets` | принято (бриф EP-11/EP-14, заморожен до волны 8) | [ep11-ep14-cto-brief.md](../../history/briefs/ep11-ep14-cto-brief.md#d-ep11-6-объём-ep-14-в-r1--только-support_tickets) |

## Общие положения

### Итог приёмки исследования

| Критерий | Результат |
|---|---|
| Документов | 12 + сводный дайджест (5 244 строки) |
| Уникальных требований REQ-* | 202 по 20 областям |
| Ссылок на первоисточники | 293 (200+ уникальных доменов) |
| Явных пометок ASSUMPTION / UNVERIFIED | 118 |
| **Вердикт** | **ПРИНЯТО.** Исследование опровергло часть цифр ТЗ — это ценность, а не дефект. |

### Часть C. Обязательные дополнения к схеме БД (сверх `docs/product/client-brief-original.txt` §II.2)

Схема ТЗ реализуется 1:1 по именам, но **обязана быть расширена** следующим:

1. `substances`, `medicine_substances` — множественные действующие вещества (D-07).
2. `medicines.control_category` — категория контроля (D-08).
3. `tenants` / `tenant_settings` — брендинг, домен, мерчант-креды, ставки комиссии (D-01, D-03).
4. `escrow_ledger` (двойная запись), `payout_schedule`, `platform_fee` — эскроу и выплаты (D-02, D-03).
5. `order_returns` + `return_status` — возвраты (D-09).
6. `order_disputes` — споры (D-24).
7. `catalog_match_queue` — очередь ручной модерации матчинга (D-06).
8. `pharmacy_api_keys` (argon2-хеш, `require_mtls`, ротация) — доступ 1С (D-11).
9. `inventory_sync_batches` + `inventory_sync_errors` — аудит выгрузок и отчёт для аптеки (D-12).
10. `prescriptions` (статус, `composite_confidence`, ссылка на файл, верификатор) — рецепты (D-14).
11. `couriers`, `courier_payouts`, `delivery_assignments` — курьерская операционка (D-21).
12. `pharmacy_verification` — лицензии и онбординг (D-22).
13. `audit_log` — неизменяемый журнал действий над заказами, деньгами и рецептами (комплаенс).
14. `outbox` — transactional outbox для доменных событий (надёжность интеграций).

### Часть D. Что вынесено заказчику (не блокирует разработку)

Эти вопросы **не останавливают** конвейер — приняты рабочие дефолты, но требуют коммерческого решения:

1. **Бренд/товарный знак** — конфликт с существующим `doru.tj` (100 k+ установок).
2. **Ставки комиссии** платформы и White-Label прайсинг (сейчас — калиброванная гипотеза).
3. **Выбор банка-партнёра** для первой реальной интеграции (сейчас — MockBankProvider).
4. **Юридическое заключение** о дистанционной продаже ЛС и о статусе ledger.
5. **Доля курьера** в `delivery_fee` и его юридический статус (самозанятый / штат / подряд).
