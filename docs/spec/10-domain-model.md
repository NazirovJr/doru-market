# DoruTJ — Доменная модель (SRS, фундамент)

> Владелец: Analyst (SRS). Статус: **BASELINE для фазы Analysis**.
> Приоритет источников при противоречии: `03-ARCHITECT-DECISIONS.md` (D-*) > `00-PROJECT-CHARTER.md` (CUJ-*, §) > `research/00-RESEARCH-DIGEST.md` (REQ-*) > `tz.log` (§ТЗ).
> Слои — по `02-CLEAN-ARCHITECTURE-AND-CODE.md`: **domain** (сущности/VO/state machine/доменные ошибки, ноль импортов фреймворка), **application** (use cases, порты), **infrastructure** (Drizzle-репозитории, адаптеры), **presentation** (контроллеры, мапперы, HTTP-коды). Каждый элемент ниже помечен слоем.
>
> Идентификаторы требований этого документа: **SRS-DOM-nnn**. Каждый снабжён ссылкой на источник
> (`REQ-*`, `D-*`, `CUJ-*`, `§ТЗ`) и сформулирован как проверяемое условие (Given/When/Then — там, где применимо).
>
> **Денежная конвенция документа**: в БД суммы хранятся как было зафиксировано в `tz.log` §II.2 —
> `NUMERIC(10,2)` в колонках с суффиксом `_tjs` (`price_tjs`, `items_total_tjs`, `delivery_fee_tjs`,
> `total_amount_tjs`, `unit_price_tjs`, `total_price_tjs`) — имена и типы колонок сохранены 1:1
> (Charter §5, `02` §1.1). Новые поля, введённые исследованием (комиссии, ledger, payout), называются
> с суффиксом `_dirams` и хранятся как `BIGINT`. **Domain и application никогда не видят `NUMERIC`
> напрямую и никогда не делают арифметику в TJS с плавающей точкой** — на границе `infrastructure`
> (Drizzle-репозиторий/маппер) значение `NUMERIC(10,2)` конвертируется в `Money` (целые дирамы) через
> `Money.fromDbDecimalTjs(value: string)` (парсинг строки, не `parseFloat`, умножение на 100 целочисленно
> через разбор `integer.fractional`), и обратно — через `money.toDbDecimalTjs(): string`. Домен работает
> ИСКЛЮЧИТЕЛЬНО с `Money` (диримы). Это разрешает конфликт между «схема 1:1 из ТЗ» и «арифметика в целых
> дирамах» (Charter §5) без изменения имён/типов колонок.

---

## Глоссарий

> Термины даны в формате RU / TJ / EN. Таджикские переводы технических терминов, отсутствующих в
> обиходном языке (эскроу, тенант, White-Label, ledger), оставлены как заимствования кириллицей —
> устоявшегося таджикского эквивалента не существует. Переводы, помеченные «⚠ требует вычитки»,
> нужно прогнать через переводчика/фармацевта перед публикацией в UI (см. REQ-REG-18, REQ-UX-19,
> Charter §5 «i18n: хардкод строки = дефект»). Общеупотребительные бытовые слова (дору, дорухона,
> сомонӣ, дирам, нусха) — устоявшаяся лексика, вычитки не требуют.

| RU | TJ | EN | Определение |
|---|---|---|---|
| Международное непатентованное наименование (МНН) | номи байналмилалии ғайрипатентӣ (⚠) | INN (International Nonproprietary Name) | Родовое наименование действующего вещества, присвоенное ВОЗ, не зависящее от торговой марки. Хранится в `medicines.inn_name` (денормализовано) и через `substances`/`medicine_substances` (D-07). |
| Дженерик | дженерик (заимств.) | generic | Препарат с тем же действующим веществом(-ами), что и оригинальный/референтный препарат, после истечения патентной защиты. В домене не отдельная сущность — это `Medicine` с совпадающим множеством `substances`. |
| Аналог | муодил / аналог (⚠) | therapeutic analog | Препарат с *идентичным множеством действующих веществ* + совместимой `dosage_form` + эквивалентной `dosage_strength` (D-07, REQ-NORM-1/2). НЕ равно «дженерик» терминологически, но в UI используется как синоним для пользователя. |
| Действующее вещество | моддаи фаъол (⚠) | active substance | Строка в `substances`, связанная с `medicines` через `medicine_substances(medicine_id, substance_id, strength_value, strength_unit)` (D-07). |
| Категория контроля | категорияи назорат (⚠) | control category | `medicines.control_category ENUM('none','prescription_only','potent','psychotropic','narcotic')` (D-08). Определяет жёсткие ограничения оборота на уровне домена. |
| Эскроу | эскроу (заимств.) | escrow | Программный ledger DoruTJ (не банковский hold/capture) — деньги клиента учитываются как удержанные до подтверждения вручения, физически лежат на счету банка-эквайера (D-02, D-17). |
| Леджер (учётный журнал) | феҳристи ҳисобот (⚠) | ledger | `escrow_ledger` — неизменяемая (append-only) двойная запись движений денег по заказу. Учётный, не расчётный (D-17). |
| Холд / удержание | нигоҳдорӣ (⚠) | hold | Состояние средств клиента, зарезервированных под заказ, ещё не выплаченных аптеке. |
| Капчур / списание в пользу аптеки | гирифтани маблағ (⚠) | capture | Операция ledger, переводящая удержанные средства (за вычетом комиссии) в `payout_schedule` аптеки после `delivered`. |
| Payout / выплата | пардохт | payout | Физический перевод денег на мерчант-счёт аптеки/сети, происходит не раньше `hold_period_days` после `delivered`, блокируется активным спором (REQ-PAY-6). |
| Комиссия платформы | комиссияи платформа | platform fee / commission | Ставка (`commission_bps`), снэпшотится на `order_items` в момент заказа, списывается как `platform_fee_captured` (D-03, REQ-MON-1/2). |
| Тенант | тенант (заимств.) | tenant | Изолированный «арендатор» платформы — нейтральный DoruTJ или White-Label сеть. Резолвится по `Host`/`X-Tenant-Slug` (Charter §3.4). |
| White-Label | White-Label (заимств.) | white-label | Режим тенанта с собственным брендом/доменом/ботом/мерчант-счётом (Charter §3.4, tz.log §III). |
| Партия (товара) | лот / партия (⚠) | batch (lot) | Группа единиц товара с одним `batch_number` и одним `expiry_date`, поступившая одной поставкой. Домен агрегирует несколько партий на один `(pharmacy_id, medicine_id)` (REQ-SYNC-8). |
| Сейф-пакет | халтаи бехатар (⚠) | tamper-evident bag | Опечатываемая упаковка, в которую фармацевт укладывает собранный заказ перед передачей курьеру (tz.log Модуль 5, CUJ-3). Домен фиксирует факт опечатывания как предусловие перехода `processing → picked_up`. |
| Ориентир | нишона / аломат (⚠) | landmark | Текстовое описание местоположения вместо/в дополнение к формальному адресу (`landmark_tj`, `saved_address.landmark_text`), например «дом с зелёной крышей у мечети» (tz.log §I.3, REQ-GEO-3, REQ-MARKET-10). |
| Дирам | дирам | diram | 1/100 сомони. Официальная разменная монета Таджикистана. Единственная единица арифметики денег в домене (Charter §5). |
| Сомони | сомонӣ | somoni (TJS) | Национальная валюта РТ. Единственная поддерживаемая валюта MVP. |
| FEFO | FEFO (аббр.) | First-Expired-First-Out | Правило выбора партии для продажи/отображения цены — партия с ближайшим `expiry_date` среди партий с `quantity > 0` (REQ-SYNC-8). |
| Composite confidence | эътимоди ҳисобшуда (⚠) | composite confidence | Детерминированная оценка достоверности OCR-распознавания, вычисленная на бэкенде из ≥4 сигналов, а не взятая напрямую из ответа модели (D-14, REQ-OCR-3). |
| LASA | LASA (аббр.) | Look-Alike/Sound-Alike | Пара препаратов со схожим написанием/произношением, риск ошибки OCR/STT (REQ-OCR-6). |
| Rx / рецептурный | доруи бо нусха (⚠) | Rx / prescription-only | Товар с `is_prescription_required = true`, требует `prescriptions.status = 'verified'` для оформления (REQ-REG-2). |
| OTP | рамзи якдафъаина (⚠) | one-time password | Одноразовый код: 6-значный для логина клиента, 4-значный для вручения заказа курьером (CUJ-2, tz.log Модуль 5, REQ-DELIV-3). |
| Аутбокс (transactional outbox) | outbox (заимств.) | transactional outbox | Таблица `outbox` в той же транзакции БД, что и доменное изменение; отдельный процесс публикует события в очередь ровно после коммита (Часть C п.14 решений архитектора). |
| Спор | баҳс / шикоят (⚠) | dispute | `order_disputes` — эскалация, атомарно замораживающая `payout_schedule.status='disputed'` (D-24). |
| Возврат | баргардонидан (⚠) | return | `order_returns` — отдельная подсистема, отличная от «обмена без причины» (D-09). |
| Онбординг | ба low‑афзудан (⚠, тех. термин) | onboarding | Двухуровневый процесс верификации: `pharmacy_chains` (юрлицо) + `pharmacies` (точка) (D-22, REQ-ONBOARD-1). |
| Партнёрский пул курьеров | ҳавзаи умумии курер (⚠) | platform courier pool | Курьеры без привязки к сети (`couriers.chain_id IS NULL`), доступные любому тенанту (REQ-COUR-1). |
| Собственный флот | флоти худӣ (⚠) | own fleet | Курьеры сети (`couriers.chain_id` заполнено), обслуживают только заказы своей сети. |
| Штрихкод / EAN-13 | рамзи миллавӣ (⚠) | barcode / EAN-13 | 13-значный код товара; префикс `2` — внутренний код продавца, не глобальный идентификатор (D-06). |
| Разблокировка звука | кушодани садо (⚠) | sound unlock gesture | Явный жест пользователя (тап по кнопке «Начать смену»), разблокирующий `AudioContext` браузера перед автовоспроизведением звука оповещения (REQ-UX-10). |
| Тенант-скоуп | доираи тенант (⚠) | tenant scope | Обязательный `chain_id`/`tenant_id`-фильтр на уровне репозитория, гарантирующий изоляцию данных White-Label (Charter §3.4). |

---

## Ограниченные контексты (Bounded Contexts)

Backend — модульный монолит (`apps/api/src/modules/<context>`), см. `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.
Межмодульное взаимодействие — **только** через публичный фасад `<context>/index.ts` (синхронный вызов)
или через **доменное событие** поверх `outbox` (асинхронно). Прямой импорт `domain`/`application`/
`infrastructure` другого модуля — блокирующее нарушение (`02` §1.1).

### Перечень контекстов

| Контекст | Зона ответственности | Ключевые агрегаты | Публичный фасад |
|---|---|---|---|
| **identity** | Пользователи, аутентификация (OTP-логин, Telegram TWA), роли RBAC, сессии/refresh-токены | `User`, `AuthSession` | `IdentityFacade` |
| **tenancy** | Резолвинг тенанта, брендинг, White-Label конфигурация, `courier_sourcing_mode` | `Tenant` | `TenancyFacade` |
| **catalog** | Справочник медикаментов, вещества, поиск, подбор аналогов по МНН | `Medicine` | `CatalogFacade` |
| **inventory** | Остатки/цены по аптекам, партии (FEFO), приём 1С/Excel/ручных выгрузок | `PharmacyInventory`, `InventorySyncBatch` | `InventoryFacade` |
| **onboarding** | Верификация аптек и сетей, лицензии, жизненный цикл `active/suspended` | `PharmacyChain`, `PharmacyAccount` | `OnboardingFacade` |
| **orders** | Корзина → заказ, `order_status`, позиции заказа, комиссия (снэпшот) | `Order` | `OrdersFacade` |
| **payments** | Провайдеры оплаты, эскроу-ledger, `payout_schedule`, реконсиляция | `EscrowLedger`, `PayoutSchedule` | `PaymentsFacade` |
| **billing** | B2B-биллинг: `cash_courier`-комиссия, White-Label роялти/абонплата, инвойсы сетям | `PlatformBillingInvoice`, `CommissionRate` | `BillingFacade` |
| **prescriptions** | Загрузка рецепта, OCR-конвейер, верификация фармацевтом | `Prescription` | `PrescriptionsFacade` |
| **delivery** | Курьеры, назначение, вручение (OTP), геотрекинг, компенсация курьера | `DeliveryAssignment`, `Courier` | `DeliveryFacade` |
| **returns** | Возврат/обмен после `picked_up`/`delivered`, restock | `OrderReturn` | `ReturnsFacade` |
| **disputes** | Тикеты поддержки, споры, разморозка/заморозка payout | `OrderDispute`, `SupportTicket` | `DisputesFacade` |
| **notifications** | Очередь исходящих Telegram/SMS/push, троттлинг | `NotificationJob` (application-уровня, без богатого домена) | `NotificationsFacade` |
| **moderation** | Очередь ручной модерации матчинга каталога, контроль новых `control_category` | `CatalogMatchQueueItem` | `ModerationFacade` |
| **analytics** | Read-модели/дашборды (только на чтение, доменных инвариантов не содержит) | — (CQRS read-side) | `AnalyticsFacade` |

### Матрица взаимодействий

> Для каждой взаимодействующей пары указан способ: **[F]** синхронный вызов фасада (в рамках одной
> транзакции/запроса) или **[E]** асинхронное доменное событие через `outbox`. Пары, не перечисленные
> ниже, не взаимодействуют напрямую — данные при необходимости агрегируются в `analytics` через
> read-модели, а не через прямую связь модулей.

| Откуда → Куда | Способ | Событие / вызов |
|---|---|---|
| orders → inventory | [F] | `InventoryFacade.reserveStock(items)` / `releaseStock(items)` при создании/отмене заказа |
| orders → catalog | [F] | `CatalogFacade.getMedicineSnapshot(ids)` — цена/название на момент заказа не хранится в catalog |
| orders → prescriptions | [F] | `PrescriptionsFacade.isVerifiedFor(customerId, medicineIds)` при оформлении Rx-позиции |
| orders → tenancy | [F] | `TenancyFacade.resolveCommissionRate(tenantId, category)` — снэпшот `commission_bps` |
| orders → onboarding | [F] | `OnboardingFacade.isPharmacyActive(pharmacyId)` — guard при checkout (`PHARMACY_SUSPENDED`) |
| orders → payments | [E] | `OrderPaidEvent` потребляется payments для создания эскроу-hold (webhook инициирует payments, который публикует `OrderPaidEvent`, а orders — подписчик, обновляющий `order.status`; связь двусторонняя событийная, см. ниже) |
| payments → orders | [E] | `EscrowCapturedEvent` → orders обновляет `order.status = 'delivered'`-производные поля (payout-метаданные, не сам статус) |
| orders → delivery | [E] | `OrderPickedUpEvent` → delivery создаёт/обновляет `DeliveryAssignment` |
| delivery → orders | [E] | `OrderDeliveredEvent` публикуется delivery (после успешного OTP), orders переводит `status='delivered'` |
| delivery → payments | [E] | `OrderDeliveredEvent` → payments выполняет `EscrowLedger.capture(...)` |
| delivery → billing | [E] | `DeliveryCompletedEvent` → billing начисляет `courier_earnings` (платформенный пул) |
| payments → billing | [F] | `BillingFacade.snapshotCommissionRate(tenantId, category)` при создании `order_items` (вызывается из orders, billing — источник ставок) |
| payments → disputes | [F] | `DisputesFacade.hasActiveDispute(orderId)` — payout-джоба перед выплатой |
| disputes → payments | [E] | `DisputeOpenedEvent`/`DisputeResolvedEvent` → payments меняет `payout_schedule.status` |
| returns → inventory | [E] | `ReturnConfirmedEvent` → inventory выполняет `restock` (идемпотентно по `order_id`) |
| returns → payments | [E] | `ReturnConfirmedEvent`/`ReturnRejectedEvent` → payments запускает частичный/полный рефанд |
| returns → delivery | [F] | `DeliveryFacade.assignReturnCourier(returnId)` |
| returns → disputes | [F] | `DisputesFacade.linkPostDeliveryClaim(returnId)` для `customer_dispute_post_delivery` |
| inventory → catalog | [F] | `CatalogFacade.resolveMedicineByComposite(barcode, tradeName, dosageForm, strength)` — composite-матчинг (D-06) |
| inventory → moderation | [E] | `UnmatchedInventoryRowEvent` → moderation создаёт запись `catalog_match_queue` |
| catalog → moderation | [E] | `NewControlCategoryCandidateEvent` при импорте с признаками контроля (D-08) |
| prescriptions → catalog | [F] | `CatalogFacade.matchByInn(rawName)` — fuzzy-сопоставление распознанных позиций |
| prescriptions → notifications | [E] | `PrescriptionNeedsClarificationEvent` → уведомление клиенту |
| onboarding → notifications | [E] | `LicenseExpiringSoonEvent`/`PharmacySuspendedEvent` → уведомление `pharmacy_admin` |
| onboarding → orders | [E] | `PharmacySuspendedEvent` → orders отменяет `pending_payment`- и `confirmed`-заказы этой аптеки (REQ-ONBOARD-13, `confirmed` — D-25) |
| onboarding → inventory | [F] | `InventoryFacade` продолжает принимать данные для `suspended`, `OnboardingFacade.isVisibleInSearch(pharmacyId)` фильтрует только поиск (REQ-ONBOARD-15) |
| tenancy → * (все контексты с данными) | [F] | Guard уровня репозитория: обязательный `tenantId`/`chainId`-скоуп (Charter §3.4), не событие — часть каждого запроса |
| delivery → notifications | [E] | `CourierAssignedEvent`, OTP-уведомления |
| payments → notifications | [E] | `OrderPaidEvent`, `PayoutPaidEvent` (для `pharmacy_admin`) |
| disputes → notifications | [E] | `DisputeOpenedEvent`, `DisputeResolvedEvent`, `SlaBreachedEvent` |
| analytics ← (все контексты) | [E] | Read-модель строится из тех же событий `outbox` (subscriber-only, никогда не пишет обратно) |

**SRS-DOM-001** [Источник: `02` §1.2, Charter §3.4] Given два модуля backend, When один обращается к
данным другого, Then обращение проходит только через `<context>Facade` метод или подписку на
доменное событие; прямой импорт `*/domain/*` или `*/infrastructure/*` чужого модуля — ошибка сборки
(`pnpm arch:check`, dependency-cruiser).

---

## Агрегаты и сущности

> Правила домена (`02` §2): приватный конструктор + фабрика `create()/restore()`, методы-намерения
> (не сеттеры), инварианты защищены самой сущностью, время/ID — через порты `Clock`/`IdGenerator`,
> ошибки — собственные классы (не `HttpException`).

### Order — слой domain (`modules/orders/domain/order.entity.ts`)

Корень агрегата: `Order`, содержит коллекцию `OrderItem` (entity, не отдельный агрегат — жизненный
цикл полностью подчинён `Order`).

**Инварианты:**

- **SRS-DOM-002** [REQ-UX-4, Charter схема `orders.pharmacy_id`] Все позиции заказа принадлежат
  ровно одной аптеке (`pharmacy_id` едино для заказа); сплит корзины по нескольким аптекам происходит
  на уровне application (`SplitCartByPharmacyUseCase`) ДО вызова `Order.create()` — на входе
  агрегата уже находится корзина одной аптеки.
  Ошибка при расхождении на входе (defensive-проверка в `Order.create()`, см.
  `21-module-orders-payments-escrow.md` §«конструктор проверяет ВСЕ инварианты SRS-DOM-002..012»):
  `OrderPharmacyMismatchError`.
- **SRS-DOM-003** [Charter §5, D-03] `total_amount = items_total + delivery_fee_diram`, где
  `items_total = Σ(order_item.unit_price × quantity)`. Значение не принимается от клиента — только
  пересчитывается сервером внутри `Order.create()`/`Order.recalculateTotals()`.
  Ошибка при расхождении на входе: `OrderTotalMismatchError`.
- **SRS-DOM-004** [REQ-REG-2, REQ-OCR-5, CUJ-5] Если хотя бы один `OrderItem.medicine.isPrescriptionRequired`,
  заказ не может быть создан без `prescriptionId`, ссылающегося на `Prescription` со статусом
  `verified`, покрывающего данный `medicineId`. Ошибка: `PrescriptionNotVerifiedError`.
- **SRS-DOM-005** [D-08, REQ-REG-4] Ни один `OrderItem.medicine.controlCategory` не может быть
  `psychotropic` или `narcotic` — жёсткий инвариант конструктора, не проверка в контроллере.
  Ошибка: `ControlledSubstanceNotOrderableError`.
- **SRS-DOM-006** [REQ-REG-6] `Order.startProcessing()` и `Order.markPickedUp()` бросают
  `ExpiredStockError`, если на момент вызова хотя бы одна выбранная партия имеет
  `expiry_date <= today` (проверяется через порт `InventorySnapshotPort`, не кэш заказа).
- **SRS-DOM-007** [D-16] `payment_method = 'cash_courier'` запрещён, если заказ содержит Rx-позицию
  ИЛИ `total_amount_diram > COD_LIMIT_TJS_diram` (per-tenant конфигурация, дефолт 500 TJS = 50000 дирам).
  Ошибки: `CodForbiddenForRxError`, `CodLimitExceededError`.
- **SRS-DOM-008** [REQ-MON-1] `order_item.commission_bps`/`commission_dirams` вычисляются и
  записываются один раз в `Order.create()` (снэпшот на момент заказа); последующее изменение тарифа
  в `commission_rates` не меняет уже созданные заказы — поля неизменяемы после создания
  (`readonly`, попытка мутации — компиляционная ошибка, а не рантайм-проверка).
- **SRS-DOM-009** [REQ-MON-5] Комиссия платформы считается только от `items_total`, не от
  `delivery_fee_diram` — формула комиссии не принимает `delivery_fee` как параметр.
- **SRS-DOM-010** [Charter, `02` §2.1] Переходы `status` — только через методы-намерения, только по
  таблице §5 «order_status». Прямое присвоение `status` вне метода недоступно (`private` сеттер).
- **SRS-DOM-011** [tz.log §II.2, Value Objects] `order_number` генерируется один раз при создании
  через `OrderNumberGeneratorPort`, неизменяем далее.
- **SRS-DOM-012** [REQ-ONBOARD-12] `Order.create()` требует предварительной проверки
  `OnboardingFacade.isPharmacyActive(pharmacyId) === true`; иначе — `PharmacySuspendedError`
  (маппится в HTTP `403 PHARMACY_SUSPENDED`).
- **SRS-DOM-180** [D-25] **Инвариант, обязателен к покрытию тестом:**
  `order.status === 'paid_escrow'` ⟺ для данного заказа существует хотя бы одна запись в
  `escrow_ledger`. Читать как: (а) любой заказ со статусом `paid_escrow` обязан иметь ≥1 запись
  леджера — статус не может «утверждать» эскроу, которого нет (это и был порок отклонённого
  архитектором варианта, см. D-25); (б) появление первой записи леджера для заказа (`recordHold`)
  обязано происходить в ТОЙ ЖЕ транзакции, что и переход `pending_payment → paid_escrow`
  (SRS-DOM-089), — леджер не заводится «в обход» статуса. Эквивалентность проверяется в момент
  перехода; она не нарушается тем, что записи `escrow_ledger` остаются навсегда (append-only,
  SRS-DOM-031) и после того, как заказ уходит из `paid_escrow` дальше по жизненному циклу.
  Наличные заказы (`payment_method='cash_courier'`, статус `confirmed`, D-25) НИКОГДА не порождают
  записей `escrow_ledger` — их комиссия взимается отдельно через `platform_billing_invoices`.

**Методы-намерения**: `Order.create(cmd): Result<Order, DomainError>`, `order.markPaidEscrow(txId, paidAt)`,
`order.startProcessing(pharmacistId)`, `order.markPickedUp(handoverOtp)`, `order.markDelivered(otpVerification)`,
`order.cancel(reason, actor)`, `order.attachReturn(returnId)`, `order.markRefunded(refundRef)`.

### Medicine — domain (`modules/catalog/domain/medicine.entity.ts`)

Корень: `Medicine`, содержит `MedicineSubstance[]` (value entity: `substanceId`, `strengthValue`,
`strengthUnit`).

**Инварианты:**

- **SRS-DOM-013** [D-07] Множество `substances` не пусто для препаратов, прошедших модерацию
  (`Medicine.publish()` бросает `MissingSubstancesError`, если `substances.length === 0`).
  Черновик (`catalog_match_queue`) может существовать без `substances` до курации.
- **SRS-DOM-014** [D-08] `controlCategory` по умолчанию `'none'`; смена на любое значение из
  `{potent, psychotropic, narcotic}` обязана пройти через `moderation` (метод
  `medicine.proposeControlCategory(category, actor)` создаёт событие
  `NewControlCategoryCandidateEvent`, само поле не меняется синхронно) — прямая мутация
  `controlCategory` в обход модерации запрещена (`ControlCategoryChangeRequiresModerationError`).
- **SRS-DOM-015** [D-08] Инвариант согласованности: `controlCategory ∈ {potent, psychotropic,
  narcotic} ⇒ isPrescriptionRequired = true`. Нарушение при конструировании — `InvalidMedicineStateError`.
- **SRS-DOM-016** [D-06] `barcode`, если задан, валидируется VO `Barcode`; невалидный/внутренний
  (префикс `2`) штрихкод НЕ является ошибкой конструктора — сохраняется, но
  `medicine.isGloballyIdentifiableByBarcode()` возвращает `false`, и composite-матчинг не использует
  его как единственный ключ (см. `InventoryFacade`/`CatalogFacade.resolveMedicineByComposite`).
- **SRS-DOM-017** [REQ-NORM-1/2, D-07] `dosageForm`/`dosageStrength` — VO `Dosage` (см. ниже);
  прямое сравнение по строке `inn_name` запрещено в `AnalogFinderService` (application/domain
  сервис) — эквивалентность считается ТОЛЬКО через множество `substances` + `Dosage.isEquivalentTo()`.

**Методы**: `Medicine.create(cmd)`, `medicine.addSubstance(substanceId, strength)`,
`medicine.proposeControlCategory(category, actor)`, `medicine.publish()`, `medicine.attachBarcode(raw)`.

### PharmacyInventory — domain (`modules/inventory/domain/pharmacy-inventory.entity.ts`)

Корень: `PharmacyInventory` (ключ `(pharmacy_id, medicine_id)`, `UNIQUE` — как в tz.log §II.2),
содержит коллекцию `InventoryBatch` (entity: `batchNumber`, `expiryDate`, `quantity`, `priceDiram`,
`lastSyncedAt`) — **расширение схемы** сверх буквального `tz.log` (там одна строка = одна партия);
расширение допустимо по Charter §5 («расширения допускаются») и обязательно по REQ-SYNC-8.

**Инварианты:**

- **SRS-DOM-018** [tz.log §II.2] `(pharmacy_id, medicine_id)` уникален на уровне агрегата — вторая
  попытка создать агрегат для той же пары обязана обновить существующий, не создать дубликат.
- **SRS-DOM-019** [REQ-SYNC-8] `stock_quantity` (публичное вычисляемое свойство) =
  `Σ(batch.quantity) для batch.quantity > 0 AND batch.expiryDate > today`.
- **SRS-DOM-020** [REQ-SYNC-8] Цена и срок годности, отображаемые в каталоге
  (`displayPrice`, `displayExpiryDate`), выбираются по FEFO: среди партий с `quantity > 0` и
  `expiryDate > today` берётся партия с минимальным `expiryDate`.
- **SRS-DOM-021** [REQ-REG-6] Партия с `expiryDate <= today` не участвует в `stock_quantity`/продаже,
  но не удаляется физически (аудит/возврат/утилизация). `PharmacyInventory.reserveForOrder()` бросает
  `InsufficientStockError`, если после исключения просроченных партий недостаточно `quantity`.
- **SRS-DOM-022** [REQ-SYNC-11] `applyDelta(batchUpsert)` игнорирует строку, если
  `batchUpsert.sync_timestamp <= existingBatch.lastSyncedAt` — не откатывает более свежие данные.
  Возвращает `{ applied: false, reason: 'stale' }`, не бросает исключение (это ожидаемый штатный
  случай батч-обработки, не ошибка).
- **SRS-DOM-023** [REQ-RET-8] `restock(quantity, reason, sourceOrderId)` только аддитивна
  (`quantity > 0`), идемпотентна по `sourceOrderId` (повторный вызов с тем же `order_id` — no-op,
  не удваивает остаток). Ошибка при `quantity <= 0`: `InvalidRestockQuantityError`.
- **SRS-DOM-024** [Money VO] `priceDiram > 0`, если `quantity > 0` — активная позиция с нулевой/
  отрицательной ценой невалидна: `InvalidPriceError`.

**Методы**: `PharmacyInventory.create(pharmacyId, medicineId)`, `inventory.applyDelta(batchUpsert)`,
`inventory.applyDelete(internalSku)`, `inventory.reserveForOrder(qty)`, `inventory.releaseReservation(qty)`,
`inventory.restock(qty, reason, sourceOrderId)`.

### Prescription — domain (`modules/prescriptions/domain/prescription.entity.ts`)

Корень: `Prescription`.

**Инварианты:**

- **SRS-DOM-025** [REQ-REG-9] `Prescription.upload()` требует `consentGiven = true`, иначе
  `ConsentNotGivenError` — согласие фиксируется ДО конструирования сущности (application слой
  собирает согласие, домен лишь проверяет флаг во входной команде).
- **SRS-DOM-026** [D-14, REQ-OCR-3] `compositeConfidence` — поле, вычисляемое исключительно
  доменным сервисом `CompositeConfidenceCalculator` (domain service) из ≥4 сигналов
  (`vlmConfidence`, `imageQualityScore`, `lasaCandidateCount`, `stampPresent` и др.); прямое
  присвоение `compositeConfidence` из ответа OCR-провайдера запрещено на уровне типов — порт
  `PrescriptionOcrProvider` возвращает `RawOcrResult` (без поля `compositeConfidence`), и только
  `CompositeConfidenceCalculator.calculate(rawResult): CompositeConfidence` производит финальное число.
- **SRS-DOM-027** [D-14, REQ-OCR-5] `Prescription.verify(pharmacistId)` доступен из статусов
  `auto_matched`/`needs_clarification` независимо от значения `compositeConfidence` — верификация
  фармацевтом обязательна всегда для Rx, высокий confidence не даёт авто-переход в `verified`.
- **SRS-DOM-028** [REQ-OCR-6] ≥2 кандидата с разницей `compositeConfidence < LASA_AMBIGUITY_MARGIN`
  (конфигурируемо, ASSUMPTION 0.1) на одну позицию рецепта форсируют статус
  `needs_clarification`, даже если топ-кандидат сам по себе ≥0.85.
- **SRS-DOM-029** [REQ-OCR-7] `Prescription.attachOcrResult()` обязан сохранить ссылку на
  `raw_model_output` (object storage key), полученную через `ObjectStorageProvider`, ДО перехода
  статуса — иначе `MissingRawOutputReferenceError`.
- **SRS-DOM-030** [REQ-REG-10] Поле `imageUrl` (алиас `prescription_image_url`) не возвращается ни в
  одном DTO кроме явного `GET /api/v1/prescriptions/:id/image` под `super_admin`/`pharmacist`,
  назначенным на заказ, — правило описано в §8 «Доменные политики», проверяется в `application`
  (`PrescriptionAccessPolicy`), не в контроллере.

**Методы**: `Prescription.upload(fileRef, consent, customerId)`, `prescription.attachOcrResult(raw)`,
`prescription.requestClarification()`, `prescription.verify(pharmacistId)`, `prescription.reject(reason, actor)`.

### EscrowLedger / EscrowLedgerEntry — domain (`modules/payments/domain/escrow-ledger.entity.ts`)

Корень агрегата: `EscrowLedger` (по одному на `order_id`), содержит append-only список
`EscrowLedgerEntry` (entity, неизменяем после добавления).

**Инварианты:**

- **SRS-DOM-031** [D-02] Записи ledger никогда не обновляются и не удаляются — только `append()`.
  Попытка мутации существующей записи — `ImmutableLedgerEntryError` (структурная гарантия: у
  `EscrowLedgerEntry` нет ни одного публичного мутатора после конструктора).
- **SRS-DOM-032** [REQ-MON-2] `platform_fee_captured` и `captured_to_pharmacy` создаются в ОДНОЙ
  прикладной транзакции (`unitOfWork.run()` в use case `CaptureEscrowUseCase`) — `EscrowLedger` как
  агрегат экспонирует единственный метод `captureOnDelivery(commissionDiram, netDiram)`, добавляющий
  обе записи атомарно; отдельных публичных методов `captureFee()`/`captureToPharmacy()` не существует.
- **SRS-DOM-033** [REQ-MON-3] Инвариант реконсиляции (проверяется джобой, не в рантайме конструктора,
  т.к. требует агрегации по всем entries): `hold_created_diram = platform_fee_captured_diram +
  captured_to_pharmacy_diram + Σ(refunded/partially_refunded/adjustment)`. `EscrowLedger.isBalanced(): boolean`.
- **SRS-DOM-034** [D-24, REQ-DISPUTE-4] `EscrowLedger.refund()`/`capture()` бросают
  `DisputeHoldViolationError`, если связанный `payout_schedule.status = 'disputed'` (проверка через
  порт `PayoutSchedulePort.getStatus(orderId)`), кроме операции `adjustment`, которая как раз и
  предназначена для пост-payout спорных случаев.
- **SRS-DOM-035** [D-24, REQ-DISPUTE-8] `entry_type = 'adjustment'` создаётся только методом
  `EscrowLedger.adjust(amountDiram, reason, actorId)`, требующим непустой `reason` и роль
  `super_admin` (проверка роли — в application через `AuthorizationPort`, домен требует
  непустой `reason`/`actorId` как обязательные параметры конструктора команды).

**Методы**: `EscrowLedger.recordHold(amountDiram, txId)`, `ledger.captureOnDelivery(commissionDiram, netDiram)`,
`ledger.refund(amountDiram, reason)`, `ledger.partiallyRefund(amountDiram, reason)`,
`ledger.adjust(amountDiram, reason, actorId)`.

### Delivery (DeliveryAssignment) — domain (`modules/delivery/domain/delivery-assignment.entity.ts`)

Корень: `DeliveryAssignment` (1:1 c активным `order_id` на нетерминальный период).

**Инварианты:**

- **SRS-DOM-036** [tz.log Модуль 5, CUJ-3/4] Только одно нетерминальное назначение на `order_id`
  одновременно — конструктор `DeliveryAssignment.create()` требует явного отсутствия активного
  назначения (проверка через порт, не хранится как поле — уникальность обеспечивается частичным
  уникальным индексом БД на `(order_id) WHERE status NOT IN ('delivered','failed','cancelled')`).
- **SRS-DOM-037** [REQ-COUR-1] `assign(courierId)` бросает `CourierTenantMismatchError`, если
  `courier.chainId IS NOT NULL AND courier.chainId != order.pharmacy.chainId` (курьер сети обслуживает
  только заказы своей сети; курьер `platform_pool` — `chainId IS NULL` — доступен всем).
- **SRS-DOM-038** [REQ-COUR-9] `assign(courierId)` бросает `CourierNotEligibleError`, если
  `order.requiresColdChain === true AND courier.vehicleEquipment.coldChainCertified !== true`.
- **SRS-DOM-039** [REQ-DELIV-3] `markDelivered(otp)`: `OtpCode` VO проверяет TTL и лимит попыток
  (см. §4 «OtpCode»); 5-я неверная попытка переводит OTP в состояние `locked`
  (`OtpAttemptsExceededError`), требуется перегенерация фармацевтом/поддержкой.
- **SRS-DOM-040** [REQ-DELIV-4] Для `payment_method = 'cash_courier'`: `markDelivered()` требует
  предварительного вызова `recordCash(collectedDiram, changeDiram)` с
  `collectedDiram - changeDiram === order.totalAmountDiram`; иначе `CashAmountMismatchError`.
  Финальный статус выставляется явным действием курьера, никогда автоматически по вебхуку.
- **SRS-DOM-041** [REQ-DELIV-2] `reassign(newCourierId, reason)` доступен диспетчеру/`super_admin`
  в любой нетерминальной стадии; алгоритм подбора («ближайший свободный») — application-сервис
  `SuggestNearestCourierUseCase`, не часть инварианта агрегата (агрегат лишь принимает готовый
  `courierId`).

**Методы**: `DeliveryAssignment.create(orderId, landmark, geoPoint)`, `assignment.assign(courierId)`,
`assignment.reassign(courierId, reason)`, `assignment.markPickedUpFromPharmacy()`,
`assignment.recordCash(collectedDiram, changeDiram)`, `assignment.markDelivered(otp)`,
`assignment.markFailed(reason)`.

### Tenant — domain (`modules/tenancy/domain/tenant.entity.ts`)

Корень: `Tenant`, содержит `TenantSettings` (value entity: branding, мерчант-креды-ссылка,
`courier_sourcing_mode`, ставки — фактические значения ставок хранятся в `commission_rates`/
`tenant_courier_payout_rules`, `TenantSettings` хранит только *ссылку* на активный набор правил).

**Инварианты:**

- **SRS-DOM-042** [D-01] Ровно один тенант со `slug = 'neutral'`, не может быть удалён/переименован
  (`Tenant.rename()` бросает `ImmutableNeutralTenantError` для нейтрального тенанта).
- **SRS-DOM-043** [Charter §3.4] `slug` — VO `TenantSlug`, уникален, неизменяем после `create()`.
- **SRS-DOM-044** [Charter §3.4] `customDomain`, если задан, уникален среди всех тенантов
  (`DuplicateCustomDomainError` на попытке конфликта).
- **SRS-DOM-045** [REQ-COUR-2] `courierSourcingMode ∈ {own_fleet, platform_pool, hybrid}` —
  невалидное значение отклоняется на уровне VO-enum, не строкой.
- **SRS-DOM-046** [D-01] Нигде в домене/UI не хранится и не выводится хардкод строки бренда — только
  `tenant.settings.brandName` (i18n-ключ `brand.name` на presentation-уровне ссылается на это поле).

**Методы**: `Tenant.create(slug, legalOwnerRef)`, `tenant.updateBranding(palette, logoRef)`,
`tenant.attachCustomDomain(domain)`, `tenant.setCourierSourcingMode(mode)`.

### PharmacyAccount (Pharmacy) — domain (`modules/onboarding/domain/pharmacy-account.entity.ts`)

Корень: `PharmacyAccount` (маппится на таблицу `pharmacies`) — операционный аккаунт конкретной точки;
родственный агрегат `PharmacyChain` (таблица `pharmacy_chains`) — юрлицо, может содержать 1..N
`PharmacyAccount`. Соло-аптека без сети всё равно создаёт `PharmacyChain` с одной дочерней точкой
(REQ-ONBOARD-2) — отдельной ветки схемы/кода нет.

**Инварианты:**

- **SRS-DOM-047** [REQ-ONBOARD-1/2] `PharmacyAccount.chainId` — `NOT NULL` всегда (даже для соло-аптеки:
  application создаёт `PharmacyChain` автоматически при подаче соло-заявки, прозрачно для пользователя).
- **SRS-DOM-048** [REQ-ONBOARD-10] `PharmacyAccount.status` не может стать `'active'`, если
  `parentChain.status ∉ {'approved', 'active'}` — проверяется через порт `PharmacyChainStatusPort`
  на каждом вызове `activate()`. Нарушение — `ParentChainNotActiveError`.
- **SRS-DOM-049** [REQ-ONBOARD-20] `updateAddress(newAddress)` на аптеке со `status = 'active'`
  переводит её в `'pending_review'` — не тихий `UPDATE` поля координат/адреса.
- **SRS-DOM-050** [REQ-ONBOARD-16/17] Переход в `'suspended'` по причине `license_expired` —
  системный (без участия человека, дневная джоба); реактивация из ЛЮБОГО `suspended` — только через
  `'pending_review'` + повторный чек-лист `super_admin`, никогда автоматически
  (`AutomaticReactivationForbiddenError` при попытке программного авто-возврата в `active`).
- **SRS-DOM-051** [D-11] `pharmacy_api_keys` (отдельная сущность, дочерняя `PharmacyAccount`) хранит
  ключ ТОЛЬКО как `argon2`-хеш; `requireMtls` — булев флаг per-pharmacy, дефолт `false`.

**Методы**: `PharmacyAccount.submit(application)`, `pharmacyAccount.approve(actor, checklist)`,
`pharmacyAccount.requestChanges(actor, notes)`, `pharmacyAccount.activate()`,
`pharmacyAccount.suspend(reason, actor)`, `pharmacyAccount.requestReactivation()`,
`pharmacyAccount.updateAddress(newAddress)`, `pharmacyAccount.rotateApiKey()`.

### Return (OrderReturn) — domain (`modules/returns/domain/order-return.entity.ts`)

Корень: `OrderReturn`.

**Инварианты:**

- **SRS-DOM-052** [D-09] Не более одного нетерминального `OrderReturn` на `order_id`
  (частичный уникальный индекс БД `WHERE status NOT IN ('return_confirmed','return_rejected')`
  — доменно дублируется guard-проверкой в `create()`).
- **SRS-DOM-053** [REQ-RET-3] `restock()` разрешён только если одновременно: `expiryDate > today +
  RETURN_RESTOCK_MIN_REMAINING_DAYS` (per-tenant, ASSUMPTION 30 дней), упаковка не вскрыта
  (`packagingIntact = true`), холодовая цепь не под подозрением (`reason !=
  'cold_chain_breach_suspected'`). Нарушение любого условия — `RestockConditionsNotMetError`,
  автоматический `disposition = 'destroy'`.
- **SRS-DOM-054** [REQ-RET-4] Товар с `controlCategory != 'none'` в возврате принудительно получает
  `disposition = 'destroy'` независимо от состояния упаковки — `restock()` для такой позиции
  бросает `ControlledSubstanceMustBeDestroyedError` при любой попытке.
- **SRS-DOM-055** [REQ-RET-7] `courierReturnFeeDirams > 0` начисляется независимо от `return_reason`/
  установленной вины — поле обязательно (`NOT NULL`) при создании возвратного рейса.
- **SRS-DOM-056** [REQ-RET-13] `return_rejected` не терминален: доступны переходы
  `admin_return_override(actor, reason) → return_confirmed` либо новая попытка
  `retryTransit() → return_in_transit` (append-only история переходов, старые записи не удаляются).

**Методы**: `OrderReturn.request(orderId, reason, initiator)`, `orderReturn.markInTransit(courierId)`,
`orderReturn.confirmReceived(pharmacistId, checklist)`, `orderReturn.reject(reason)`,
`orderReturn.adminOverride(actor, reason)`, `orderReturn.retryTransit(courierId)`.

### Dispute (OrderDispute) — domain (`modules/disputes/domain/order-dispute.entity.ts`)

Корень: `OrderDispute`.

**Инварианты:**

- **SRS-DOM-057** [REQ-DISPUTE-3] Не более одного нетерминального `OrderDispute` на `order_id`
  (частичный уникальный индекс БД + guard в `open()`).
- **SRS-DOM-058** [REQ-DISPUTE-2/4] `OrderDispute.open()` со `isEscrowBlocking = true` в ОДНОЙ
  транзакции (application `OpenDisputeUseCase.execute()` внутри `unitOfWork.run()`) создаёт запись
  спора И переводит `payout_schedule.status = 'disputed'` через `PaymentsFacade.holdPayout(orderId,
  disputeId)`. Если `payout_schedule` уже `'paid'` — открытие спора не бросает ошибку, но
  флагирует `requiresAdjustment = true` (путь REQ-DISPUTE-8 вместо блокировки).
- **SRS-DOM-059** [REQ-DISPUTE-5] Единственный путь `disputed → due`: `resolveReject(reason, actor)`
  с непустым `reason`; таймаут НЕ является допустимым триггером — в кодовой базе нет механизма,
  который вызывает `resolveReject` по расписанию.
- **SRS-DOM-060** [REQ-DISPUTE-13] Каждый терминальный метод (`resolveReject`, `resolveRefundFull`,
  `resolveRefundPartial`, `resolveAdjustment`) требует непустых `resolutionReason` и
  `resolvedByUserId` — отсутствие любого поля бросает `MissingResolutionReasonError` до записи в БД
  (доменная валидация, дублируется `NOT NULL`+`CHECK`-constraint в БД).
- **SRS-DOM-061** [REQ-DISPUTE-10] `pharmacy_admin`/`pharmacist`, принадлежащие сети данного заказа,
  не могут быть `resolvedByUserId` для спора по заказу своей же сети — проверка роли/владения в
  application (`DisputeAuthorizationPolicy.canResolve(actor, dispute)`), домен требует, чтобы команда
  на вход уже несла проверенный `actorId` с ролью, отличной от `pharmacy_admin/pharmacist` этой сети.
- **SRS-DOM-062** [REQ-DISPUTE-11] Для заказа White-Label тенанта `close()` (перевод из
  `resolved_refund_*` в финальное `closed`-состояние истории) блокирован до вызова
  `confirmTenantRefund(tenantAdminId)` — отдельный публичный метод, отдельная запись в
  `dispute_status_history`.
- **SRS-DOM-063** [REQ-DISPUTE-8] `resolveAdjustment(amountDiram, actorId, reason)` доступен ТОЛЬКО
  когда связанный `payout_schedule.status = 'paid'` (пост-payout случай); для `due`/`disputed`
  использовать `resolveRefundFull`/`resolveRefundPartial`. Неверный статус —
  `DisputeAfterPayoutRequiresAdjustmentError` (или обратная ошибка, если вызван не тот метод).

**Методы**: `OrderDispute.open(ticketId, orderId, isEscrowBlocking)`, `dispute.resolveReject(reason, actorId)`,
`dispute.resolveRefundFull(actorId, reason)`, `dispute.resolveRefundPartial(amountDiram, actorId, reason)`,
`dispute.resolveAdjustment(amountDiram, actorId, reason)`, `dispute.escalatePriority()`,
`dispute.confirmTenantRefund(tenantAdminId)`.

### Сопутствующие агрегаты (кратко, полные инварианты — см. §5/§6)

| Агрегат | Модуль | Роль |
|---|---|---|
| `PharmacyChain` | onboarding | Юрлицо-родитель для `PharmacyAccount`, статус `chain_onboarding_status` |
| `Courier` | delivery | `chainId` (NULL=платформенный пул), `taxStatus`, `vehicleType`, `status` |
| `SupportTicket` | disputes | Канало-независимый тикет (`in_app`/`telegram_bot`/`phone`/`system_auto`), может породить `OrderDispute` |
| `InventorySyncBatch` | inventory | Единица приёма 1С/Excel-выгрузки, состояние см. §5 |
| `PlatformBillingInvoice` | billing | Инвойс сети (`cash_courier`-комиссия/White-Label роялти) |
| `CatalogMatchQueueItem` | moderation | Неоднозначная позиция каталога, ожидающая ручной курации |

---

## Value Objects

> `02` §2.3: примитивы (`string`/`number`) в сигнатурах домена — запах (primitive obsession).
> Ниже — полный список обязательных VO. Все — неизменяемые (`readonly`), сравнение по значению,
> валидация в конструкторе/статической фабрике `parse()`, возвращающей `Result<VO, ValidationError>`
> (не бросающей исключение на «ожидаемый» пользовательский ввод — исключение допустимо только для
> программной ошибки вызывающего кода).

### Money

- **SRS-DOM-064** [Charter §5, D-02] Внутреннее представление — `bigint` целых дирамов
  (`1 TJS = 100 diram`). Конструктор `Money.fromDiram(n: bigint)`; float как входной тип запрещён
  типами (`Money.fromDiram(n: number)` не существует в публичном API).
- **SRS-DOM-065** [Charter §5] `Money.fromDbDecimalTjs(raw: string): Money` — единственный легальный
  способ получить `Money` из колонки `NUMERIC(10,2)`: парсинг строки вида `"123.45"` через разбиение
  на целую/дробную часть (`123n * 100n + 45n`), без `parseFloat`/`Number()`. Обратное преобразование —
  `money.toDbDecimalTjs(): string`, форматирующее `diram / 100` как строку с ровно 2 знаками
  (целочисленное деление + модуль, без float).
- **SRS-DOM-066** Арифметика: `add(other: Money)`, `subtract(other: Money)` — требуют одинаковой
  `currency` (MVP — только `'TJS'`), иначе `CurrencyMismatchError`. `multiplyByQuantity(qty: number)`
  — только целочисленное `qty > 0`. Деления НЕТ как метода `divide()` — вместо неё
  `allocate(ratios: readonly number[]): Money[]` (метод наибольшего остатка/largest remainder method),
  гарантирующий `Σ(allocate(...)) === original` без потери дирама на округлении. Используется при
  раздельном биллинге `items`/`delivery` (REQ-RET-6) и при пропорциональном частичном рефанде.
- **SRS-DOM-067** `isNegative()`/`isZero()`/`isPositive()`; создание отрицательной суммы явным
  конструктором запрещено (`Money.fromDiram` требует `n >= 0n`) — для операций, которым нужен знак
  (например, `escrow_ledger.adjustment` может быть и дебетом, и кредитом), направление кодируется
  отдельным полем `direction: 'debit' | 'credit'` на `EscrowLedgerEntry`, а не отрицательным `Money`.
- **SRS-DOM-068** Сравнение: `equals`, `isGreaterThan`, `isLessThanOrEqual` — только между `Money`
  одной валюты.

### PhoneNumber

- **SRS-DOM-069** [tz.log формат «+992 XX XXX XX XX»] `PhoneNumber.parse(raw: string)`: нормализация
  (удаление пробелов/дефисов/скобок) → строгая валидация регэкспом `^\+992\d{9}$` (код страны + 9
  цифр). Несоответствие — `InvalidPhoneNumberFormatError`.
- **SRS-DOM-070** Определение оператора (Tcell/Babilon-Mobile/Megafon Tajikistan/Beeline TJ) по
  префиксу — ИНФОРМАЦИОННОЕ поле `operatorHint(): string | 'unknown'`, ASSUMPTION-таблица префиксов,
  **не участвует в валидации** (незнакомый/новый префикс не блокирует регистрацию — только
  `+992` + 9 цифр обязательны).
- **SRS-DOM-071** `PhoneNumber.toDisplayFormat(): string` → `"+992 XX XXX XX XX"` только на
  presentation-уровне; домен хранит канонический E.164-подобный вид без пробелов.

### GeoPoint

- **SRS-DOM-072** [tz.log `latitude NUMERIC(10,8)`, `longitude NUMERIC(11,8)`] `GeoPoint.create(lat,
  lon)`: жёсткая валидация диапазона `lat ∈ [-90, 90]`, `lon ∈ [-180, 180]` (`InvalidCoordinatesError`
  при нарушении). Проверка «внутри Таджикистана» (примерный bbox `lat 36.6–41.1`, `lon 67.3–75.2`) —
  МЯГКАЯ (`isLikelyWithinTajikistan(): boolean`), используется только для UX-предупреждения
  («координата вне ожидаемой области»), не блокирует сохранение — GPS-дрейф и приграничные районы
  реальны.
- **SRS-DOM-073** [REQ-DELIV-1] `distanceTo(other: GeoPoint): Meters` — формула гаверсинуса,
  используется в `delivery_fee_tjs = base_rate + rate_per_km × distanceTo(...)`. Точное равенство
  двух `GeoPoint` не проверяется в бизнес-правилах (только приблизительно, `epsilon = 0.0001°`, и то
  лишь в тестах, не в продуктовой логике).

### Barcode

- **SRS-DOM-074** [D-06] `Barcode.parse(raw: string)`: длина ровно 13 цифр для валидного EAN-13.
  Контрольная цифра проверяется алгоритмом GS1: для цифр `d1..d12` (первые 12) сумма
  `S = d1+d3+d5+d7+d9+d11 (нечётные позиции ×1) + 3×(d2+d4+d6+d8+d10+d12 (чётные позиции ×3))`;
  контрольная цифра `d13 = (10 - (S mod 10)) mod 10`. Несовпадение — `isValidEan13() === false`, НЕ
  исключение (штрихкод сохраняется как «сырой» для аудита, composite-матчинг просто его игнорирует
  как первичный ключ).
- **SRS-DOM-075** [D-06] `Barcode.isInternalPrefix(): boolean` — `true`, если первая цифра `'2'`
  (GS1 restricted circulation number range) — такой код никогда не используется как единственный
  критерий сопоставления товара между аптеками разных сетей.
- **SRS-DOM-076** Строки длиной ≠13 (например, внутренние SKU-коды продавца) допустимы как
  `rawValue`, но `Barcode.parse()` в этом случае возвращает объект с `format = 'non_ean13'`,
  который composite-матчинг (`inventory`) трактует как `internal_sku`, а не `barcode`.

### Dosage

- **SRS-DOM-077** [REQ-NORM-2] `Dosage.parse("500 мг")`/`Dosage.parse("10 мг/мл")`: разбор на
  `value: number`, `unit: DosageUnit` (`enum: mg | mcg | g | ml | iu | percent | mg_per_ml`).
  Единица — отдельное типизированное поле, не склеена со значением в одну строку внутри домена.
- **SRS-DOM-078** [REQ-NORM-2, D-07] `isEquivalentTo(other: Dosage): boolean` — эквивалентность
  ТОЛЬКО внутри одного семейства единиц (масса: `mg/mcg/g` — конвертируются десятично; объём: `ml` —
  не конвертируется в массу; активность: `iu` — не конвертируется ни во что). Конверсия массы:
  `1 g = 1000 mg = 1_000_000 mcg` (целочисленно через `bigint`-множитель, без float). Сравнение
  строгое (точное совпадение после конвертации в базовую единицу) — терапевтическая эквивалентность
  требует ТОЧНОГО совпадения дозировки, никакого допуска «±10%» по умолчанию
  (`DOSAGE_EQUIVALENCE_TOLERANCE_PCT = 0` как явная константа, конфигурируемая, но с дефолтом 0).
- **SRS-DOM-079** [REQ-NORM-1] `dosageForm` — отдельный VO `DosageForm` (укрупнённые классы:
  `tablet|capsule|syrup|injection|ointment|drops|inhaler|suppository|other`); эквивалентность форм —
  точное совпадение класса (таблетка не эквивалентна сиропу для целей блока аналогов).

### OtpCode

- **SRS-DOM-080** [CUJ-2, tz.log Модуль 5, REQ-DELIV-3] `OtpCode` параметризован `purpose:
  'login' | 'delivery_handover'`. `login`: 6 цифр, `ttlSeconds` ASSUMPTION 300 (5 минут),
  без ограничения попыток кроме общего rate-limit на эндпоинт. `delivery_handover`: 4 цифры,
  `ttlSeconds` ASSUMPTION 900 (15 минут после `markPickedUpFromPharmacy`), `maxAttempts = 5`.
- **SRS-DOM-081** Генерация — исключительно через порт `OtpGeneratorPort` (криптографически стойкий
  ГПСЧ инфраструктуры), НЕ `Math.random()` внутри домена (`02` §2.6: домен чист от `Math.random`).
  Домен получает уже сгенерированное значение и лишь хранит/проверяет его.
- **SRS-DOM-082** `verify(candidate: string, clock: Clock): Result<void, OtpError>`: возвращает
  `OtpExpiredError`, если `clock.now() > issuedAt + ttlSeconds`; `OtpAttemptsExceededError`, если
  `attemptsUsed >= maxAttempts`; `OtpMismatchError` + инкремент `attemptsUsed`, если код не совпал;
  успех — единственный путь, обнуляющий/финализирующий OTP (повторное использование того же кода
  после успеха невозможно — `alreadyConsumed` флаг).

### TenantId / TenantSlug

- **SRS-DOM-083** [Charter §3.4] `TenantId` — обёртка над `UUID` (`tenants.id`).
- **SRS-DOM-084** `TenantSlug.parse(raw)`: `^[a-z0-9-]{3,32}$`, зарезервированные значения
  (`'neutral'` разрешён только для системного нейтрального тенанта, `'admin'`, `'api'`, `'www'` —
  запрещены как slug новой White-Label сети): `ReservedTenantSlugError`.

### OrderNumber

- **SRS-DOM-085** [tz.log `order_number VARCHAR(20) UNIQUE`] Формат генерации:
  `DTJ-{YYMMDD}-{seq5}`, например `DTJ-260827-00001` (3+1+6+1+5 = 16 символов, укладывается в 20).
  `seq5` — 5-значный, ведущие нули, атомарный счётчик за календарный день (`Asia/Dushanbe`),
  реализуется портом `OrderNumberGeneratorPort` (инфраструктура — Redis `INCR
  order_seq:{YYMMDD}` с `EXPIRE` на 48 часов). При `seq5 > 99999` за один день —
  `OrderNumberSequenceExhaustedError` (эксплуатационный алерт; при целевой нагрузке D-05
  практически недостижимо).
- **SRS-DOM-086** `OrderNumber` неизменяем после присвоения агрегату `Order` — метода `regenerate()`
  не существует.

### ExpiryDate

- **SRS-DOM-087** [REQ-REG-6] `ExpiryDate.isSellable(today: Date): boolean` → `false`, если
  `date <= today` — используется как ЖЁСТКАЯ блокировка (SRS-DOM-006, SRS-DOM-021), значение не
  конфигурируется.
- **SRS-DOM-088** [REQ-RET-3] `ExpiryDate.hasMinimumRemainingShelfLife(today, minDays): boolean` —
  ОТДЕЛЬНОЕ мягкое/контекстное правило (используется только в `restock()`, буфер
  `RETURN_RESTOCK_MIN_REMAINING_DAYS` per-tenant, ASSUMPTION 30 дней) — НЕ путать с
  `isSellable()`, у которого буфер всегда 0.

---

## State machines

> Общее правило (`02` §2.4): переходы — только через явную таблицу; попытка недопустимого перехода
> бросает `InvalidStateTransitionError` (конкретизированную под контекст, например
> `InvalidOrderStatusTransitionError`). Ниже — по одной диаграмме + таблице на state machine,
> и явный список запрещённых переходов.

### 1. `order_status`

Базовые значения — 1:1 из `tz.log` §II.2 (`pending_payment, paid_escrow, processing, picked_up,
delivered, cancelled, refunded`); аддитивно расширено `return_in_progress` (REQ-RET-1, D-09) и
`confirmed` (D-25) — статус наличных заказов (`payment_method='cash_courier'`), в который
`Order.create()` переводит заказ синхронно, В ОБХОД `pending_payment`; статус НЕ утверждает
финансового факта (эскроу-записи не создаются, платёж — физический факт, фиксируемый позже в
`markDelivered()`, см. SRS-DOM-040).

```
                    ┌───────────────────┐
                    │  pending_payment  │
                    └─────────┬─────────┘
             ┌────────────────┼─────────────────┐
             │ webhook PAID   │ pickup_sla       │ customer cancel /
             │ HOLD (signed)  │ timeout /        │ pharmacy_suspended
             ▼                │ customer cancel  ▼
     ┌───────────────┐        │           ┌────────────┐
     │  paid_escrow  │        └──────────>│ cancelled  │◄────────────┐
     └───────┬───────┘                    └────────────┘             │
             │ pharmacist accepts                  ▲                 │
             │ (barcode+SLA start)                 │ cancel before   │
             ▼                                     │ pickup          │
     ┌───────────────┐   pickup_sla+buffer   ───────┘                │
     │   processing  │───timeout (auto-refund)──────────────────────►│
     └───────┬───────┘                                               │
             │ "Передано курьеру" + OTP generated                    │
             ▼                                                       │
     ┌───────────────┐   customer refused / undeliverable            │
     │   picked_up   │─────────────┐                                 │
     └───────┬───────┘             ▼                                 │
             │ OTP verified   ┌─────────────────────┐                │
             ▼                │ return_in_progress  │                │
     ┌───────────────┐        └──────────┬──────────┘                │
     │   delivered   │◄── return_rejected┘  return_confirmed         │
     └───────┬───────┘        (revert)         │ (full refund,       │
             │ post-delivery return/dispute     │  no delivery)       │
             │ resolved with refund             ▼                    │
             ▼                            ┌────────────┘             │
     ┌───────────────┐                    │                          │
     │return_in_progr│◄───────────────────┘                          │
     │ess (from      │                                               │
     │ delivered)    │                                               │
     └───────┬───────┘                                               │
             │ return_confirmed + refund executed                    │
             ▼                                                       │
     ┌───────────────┐                                               │
     │   refunded    │ (терминальный)                                │
     └───────────────┘                                               │
```

Ветка `confirmed` (D-25) — второй, параллельный `pending_payment`, вход в машину состояний:
активируется НЕ переходом откуда-то, а самим `Order.create()` при `payment_method='cash_courier'`.
Узлы `processing`/`cancelled` — те же самые состояния, что и в основной диаграмме выше (не дубликаты):

```
     ┌────────────────────────┐
     │ Order.create()         │
     │ payment_method =        │
     │ 'cash_courier'          │
     └───────────┬────────────┘
                 │ синхронно, в той же транзакции (D-25) —
                 │ НЕ через pending_payment/paid_escrow
                 ▼
         ┌───────────────┐
         │  confirmed    │
         └───────┬───────┘
      pharmacist accepts   │   pickup_sla+buffer timeout,
      (условия = SRS-DOM-091)   БЕЗ рефанда (нечего возвращать) —
                 │           только освобождение резерва остатка
        ┌────────┴────────┐
        ▼                 ▼
 ┌───────────────┐  ┌────────────┐
 │   processing  │  │ cancelled  │   ← те же узлы, что выше
 └───────────────┘  └────────────┘
```

| Из | В | Кто может | При каком условии | Что происходит | SRS |
|---|---|---|---|---|---|
| `pending_payment` | `paid_escrow` | система (webhook) | HMAC-подпись валидна, идемпотентность по `payment_operation_id`, товар всё ещё зарезервирован. **Применимо только когда `payment_method ≠ 'cash_courier'`** — для `cash_courier` этот переход НЕ применяется вовсе: заказ никогда не создаётся в `pending_payment`, а сразу в `confirmed` (D-25, см. ветку `confirmed` выше) | `EscrowLedger.recordHold`, событие `OrderPaidEvent` | **SRS-DOM-089** [REQ-PAY-1/2/3, CUJ-2] |
| `pending_payment` | `cancelled` | `customer`, система | явная отмена клиентом до оплаты, ИЛИ каскад `PharmacySuspendedEvent` (REQ-ONBOARD-13) | Освобождение резерва остатка, событие `OrderCancelledEvent` | **SRS-DOM-090** |
| `paid_escrow` | `processing` | `pharmacist` | `actor.pharmacyId === order.pharmacyId`, остаток ещё доступен | Старт SLA-таймера 7 мин (Charter, tz.log Модуль 5), событие `OrderProcessingStartedEvent` | **SRS-DOM-091** [CUJ-3] |
| `paid_escrow` | `cancelled` | система, `super_admin` | `pickup_sla + buffer` истёк без принятия фармацевтом (REQ-PAY-5) | Полный `PaymentProvider.refund()`, `EscrowLedger.refund`, событие `OrderAutoCancelledEvent` | **SRS-DOM-092** [D-19] |
| `confirmed` | `processing` | `pharmacist` | `actor.pharmacyId === order.pharmacyId`, остаток ещё доступен — условия идентичны SRS-DOM-091 (зеркальный переход для наличных заказов) | Старт SLA-таймера 7 мин, событие `OrderProcessingStartedEvent` | **SRS-DOM-178** [D-25] |
| `confirmed` | `cancelled` | система, `super_admin` | `pickup_sla + buffer` истёк без принятия фармацевтом (зеркало SRS-DOM-092) | Освобождение резерва остатка, событие `OrderAutoCancelledEvent`; **БЕЗ рефанда** — возвращать нечего, `escrow_ledger` для этого заказа никогда не создавался | **SRS-DOM-179** [D-25] |
| `processing` | `cancelled` | `pharmacist`, `customer` (до `picked_up`) | явная отмена с причиной, товар физически ещё в аптеке | Восстановление резерва, полный рефанд, событие `OrderCancelledEvent` | **SRS-DOM-093** |
| `processing` | `picked_up` | `pharmacist` | все позиции отсканированы, дозировка/срок годности валидны, сейф-пакет опечатан | Генерация вручительного OTP (4 цифры), `DeliveryAssignment` активируется, событие `OrderPickedUpEvent` | **SRS-DOM-094** [REQ-REG-6/7, CUJ-3] |
| `picked_up` | `delivered` | `courier` | верный OTP введён (в пределах TTL и лимита попыток) | `EscrowLedger.captureOnDelivery`, создание/обновление строки `payout_schedule`, событие `OrderDeliveredEvent` | **SRS-DOM-095** [REQ-DELIV-3, CUJ-4] |
| `picked_up` | `return_in_progress` | `courier`/диспетчер | клиент отказался принять / адрес недостижим | Создание `OrderReturn` с `return_reason='refused_at_door'`/`'undeliverable'` | **SRS-DOM-096** [D-09] |
| `return_in_progress` (из `picked_up`) | `cancelled` | система (после `return_confirmed`) | товар физически вернулся в аптеку, доставка так и не состоялась | Полный рефанд, `EscrowLedger.refund`, restock | **SRS-DOM-097** |
| `delivered` | `return_in_progress` | `customer` | в пределах `dispute_window_days`/окна возврата (REQ-RET-12) | Создание `OrderReturn`, назначение курьера на обратный забор | **SRS-DOM-098** [REQ-RET-12] |
| `return_in_progress` (из `delivered`) | `delivered` | система | `return_rejected` без `admin_return_override` | Заказ остаётся в исходном состоянии `delivered` | **SRS-DOM-099** [REQ-RET-13] |
| `return_in_progress` | `refunded` | система | `return_confirmed`, рефанд выполнен (полный/частичный) | `EscrowLedger.refund`/`partiallyRefund`, `payout_schedule` скорректирован/`reversed` | **SRS-DOM-100** [REQ-RET-6, D-09] |
| `delivered` | `refunded` | система (по резолюции спора) | `OrderDispute.resolveRefundFull`/`resolveRefundPartial` (частичный только меняет суммы, не обязательно статус заказа — см. примечание) | `EscrowLedger.refund`, `payout_schedule` reversed/уменьшен | **SRS-DOM-101** [REQ-DISPUTE-6/7] |

> Примечание: `resolveRefundPartial` НЕ обязан переводить `order.status` в `refunded` — частичный
> возврат может сосуществовать со статусом `delivered` (заказ физически доставлен, часть суммы
> возвращена). Полный переход в `refunded` — только при 100%-ном возврате (SRS-DOM-101 применим
> буквально только к `resolveRefundFull`; частичный обрабатывается как побочный эффект без смены
> `order_status`).

**Запрещённые переходы (SRS-DOM-102, источник: `02` §2.4, здравый смысл процесса):**
`delivered → processing|paid_escrow|pending_payment` (нет отката назад);
`cancelled → *` и `refunded → *` (терминальны, из них нет исходящих переходов);
`pending_payment → picked_up|delivered` напрямую (нельзя миновать оплату и сборку);
`paid_escrow → picked_up|delivered` напрямую (нельзя миновать `processing`);
`processing → delivered` напрямую (нельзя миновать `picked_up`/OTP вручения);
любой статус `→ paid_escrow`, кроме как из `pending_payment` (эскроу не переоткрывается повторно);
`confirmed → paid_escrow` (наличный заказ не может задним числом стать эскроу-оплаченным — частный
случай правила выше, выделен явно, т.к. `confirmed` и `pending_payment` внешне похожи, D-25);
`paid_escrow → confirmed` (эскроу-заказ не может «понизиться» до наличного-подтверждённого статуса —
это разные типы оплаты, переход между ними невозможен ни в одну сторону, D-25).

### 2. Payment / Escrow status (`payout_schedule.status`)

Ledger (`escrow_ledger`) — append-only последовательность записей (не state machine в классическом
смысле), см. инварианты SRS-DOM-031..035. Управляемый статус — `payout_schedule.status`.

```
   ┌─────────┐  order.delivered      ┌───────┐  hold_period_days   ┌──────┐
   │ pending │──────────────────────>│  due  │─────────elapsed────>│ paid │
   └────┬────┘                       └───┬───┘                     └──┬───┘
        │ full refund                    │ dispute opened               │ dispute opened
        │ before hold ends                ▼ (atomic)                    │ AFTER payout
        ▼                          ┌────────────┐                       ▼
   ┌──────────┐                    │  disputed  │              (status остаётся 'paid';
   │ reversed │◄───resolve_refund──┤            │               создаётся `adjustment`-запись,
   └──────────┘   _full────────────┴─────┬──────┘               нетится в СЛЕДУЮЩИЙ payout той
                                          │ resolve_reject         же аптеки — REQ-DISPUTE-8)
                                          ▼
                                        due (amount уменьшен при resolve_refund_partial)
```

| Из | В | Кто может | При каком условии | Что происходит | SRS |
|---|---|---|---|---|---|
| `pending` | `due` | система (джоба) | `order.status='delivered'` И `hold_period_days` истёк (T+1, D-19) И нет активного спора | Помечается готовым к ближайшему payout-батчу, событие `PayoutDueEvent` | **SRS-DOM-103** [REQ-PAY-6, D-19] |
| `pending` | `reversed` | система | полный рефанд (возврат/спор) до истечения `hold_period_days` | `escrow_ledger` запись `refunded`, событие `PayoutReversedEvent` | **SRS-DOM-104** |
| `due` | `disputed` | система (атомарно с `OrderDispute.open`) | `is_escrow_blocking=true` | `held_by_dispute_id` заполняется, событие `PayoutHeldEvent` | **SRS-DOM-105** [REQ-DISPUTE-2/4] |
| `disputed` | `due` | `super_admin` (через `resolveReject`) | непустой `resolution_reason` | `held_by_dispute_id` очищается, событие `PayoutReleasedEvent` | **SRS-DOM-106** [REQ-DISPUTE-5] |
| `disputed` | `due` (сумма уменьшена) | `super_admin` (через `resolveRefundPartial`) | `resolution_amount_dirams` задан | `amount_dirams -= resolution_amount_dirams`, событие `PayoutAmountAdjustedEvent` | **SRS-DOM-107** [REQ-DISPUTE-7] |
| `disputed` | `reversed` | `super_admin` (через `resolveRefundFull`) | — | Полный `PaymentProvider.refund()`, событие `PayoutReversedEvent` | **SRS-DOM-108** [REQ-DISPUTE-6] |
| `due` | `paid` | система (payout-джоба) | `status='due'`, банковский перевод на мерчант-счёт аптеки подтверждён | Событие `PayoutPaidEvent` | **SRS-DOM-109** [REQ-PAY-6] |
| `paid` | `paid` (без смены статуса) | `super_admin` (через `resolveAdjustment`) | спор открыт ПОСЛЕ `paid` | Запись `escrow_ledger.adjustment`, зачёт в следующий `payout_schedule` этой аптеки (открытый вопрос ОВ.24 — юридически подтверждается отдельно) | **SRS-DOM-110** [REQ-DISPUTE-8] |

**Запрещённые переходы (SRS-DOM-111):** `reversed → *` (терминален); `paid → disputed` (статус
записи не меняется — используется параллельный механизм `adjustment`, см. выше); `disputed → paid`
напрямую (обязателен промежуточный `due`); `pending → paid` напрямую (обязателен `due`); любой
переход, инициированный истечением времени без явного разрешающего события (кроме `pending → due`,
которое ЯВЛЯЕТСЯ временным триггером по дизайну, D-19).

### 3. `prescription_status`

Базовые значения tz.log (`uploaded, verified, rejected`) расширены (D-14, REQ-OCR):
`ocr_processing, auto_matched, needs_clarification`.

```
 uploaded ──consent+enqueue──> ocr_processing ──confidence≥0.85 & no LASA──> auto_matched
                                     │                                          │  │
                                     │──0.50≤conf<0.85 OR ≥2 LASA──> needs_clarification   │pharmacist
                                     │                                     │    │           │verify
                                     │──conf<0.50 OR provider hard fail──> rejected          │
                                     │                                     │ customer        ▼
                                     │                                     │ clarifies    verified
                                     │                                     └──────┐ (terminal)
                                     │                                            ▼
                                     │                                     auto_matched (re-evaluated)
                                     │                                            │
                                     │                              clarification_window expired
                                     │                              OR pharmacist rejects
                                     └───────────────────────────────────────>  rejected (terminal)
```

| Из | В | Кто может | При каком условии | Что происходит | SRS |
|---|---|---|---|---|---|
| `uploaded` | `ocr_processing` | система | `consent_given=true`, файл сохранён в object storage | Джоба OCR поставлена в очередь, событие `PrescriptionOcrRequestedEvent` | **SRS-DOM-112** [REQ-REG-9] |
| `ocr_processing` | `auto_matched` | система | `composite_confidence ≥ 0.85` И нет ≥2 LASA-кандидатов на одну позицию | Событие `PrescriptionAutoMatchedEvent` | **SRS-DOM-113** [D-14] |
| `ocr_processing` | `needs_clarification` | система | `0.50 ≤ composite_confidence < 0.85` ИЛИ ≥2 близких LASA-кандидата | Уведомление клиенту с просьбой уточнить, событие `PrescriptionNeedsClarificationEvent` | **SRS-DOM-114** [D-14, REQ-OCR-6] |
| `ocr_processing` | `rejected` | система | `composite_confidence < 0.50` ИЛИ провайдер вернул неустранимую ошибку после retry | Событие `PrescriptionRejectedEvent` | **SRS-DOM-115** [D-14] |
| `needs_clarification` | `auto_matched` | `customer` | клиент выбрал корректный вариант из предложенных кандидатов | Пересчёт `composite_confidence` для выбранной позиции | **SRS-DOM-116** |
| `needs_clarification` | `rejected` | система | `clarification_window` истёк (ASSUMPTION 24 ч) без ответа клиента | Событие `PrescriptionClarificationTimedOutEvent` | **SRS-DOM-117** |
| `auto_matched` | `verified` | `pharmacist` | явное подтверждение фармацевтом — ОБЯЗАТЕЛЬНО независимо от `composite_confidence` | Событие `PrescriptionVerifiedEvent`, разблокирует Rx-заказ | **SRS-DOM-118** [REQ-OCR-5, REQ-REG-2, CUJ-5] |
| `auto_matched` | `rejected` | `pharmacist` | нечитаемо/подозрение на подделку/нет печати | Событие `PrescriptionRejectedEvent` | **SRS-DOM-119** |

**Запрещённые переходы (SRS-DOM-120):** `verified → *` (терминален — новая правка требует НОВОЙ
загрузки, отдельного `prescription_id`); `rejected → verified` (нельзя «реанимировать» отклонённый
рецепт — только новая загрузка); `uploaded → verified/auto_matched` напрямую, минуя
`ocr_processing`; любой переход в `verified`, инициированный не `pharmacist` (в т.ч. системой
автоматически по высокому `composite_confidence`).

### 4. `return_status`

```
return_requested ──courier assigned──> return_in_transit ──arrived, geo-radius scan──> returned_to_pharmacy
                                                                                              │
                                                                        ┌─────────────────────┼───────────────────┐
                                                                        ▼                                         ▼
                                                                return_confirmed                          return_rejected
                                                                  (terminal,                          (non-terminal — REQ-RET-13)
                                                                restock/destroy)                               │
                                                                                                   ┌────────────┴────────────┐
                                                                                                   ▼                         ▼
                                                                                          admin_return_override      retryTransit()
                                                                                          → return_confirmed        → return_in_transit
```

| Из | В | Кто может | При каком условии | Что происходит | SRS |
|---|---|---|---|---|---|
| — | `return_requested` | `customer`/`courier`/диспетчер | заказ в `picked_up`/`delivered` и не позднее `dispute_window_days` (для post-delivery) | Создан `OrderReturn`, событие `ReturnRequestedEvent` | **SRS-DOM-121** [REQ-RET-1/12] |
| `return_requested` | `return_in_transit` | диспетчер/система | курьер назначен на обратный забор | Курьеру начисляется `courier_return_fee_dirams` (REQ-RET-7) | **SRS-DOM-122** [REQ-RET-2] |
| `return_in_transit` | `returned_to_pharmacy` | `courier` | сканирование штрихкода в гео-радиусе аптеки (`BarcodeScannerProvider`, без OTP) | Событие `ReturnArrivedAtPharmacyEvent` | **SRS-DOM-123** [REQ-RET-2] |
| `returned_to_pharmacy` | `return_confirmed` | `pharmacist` | чек-лист (упаковка/срок годности/холод. цепь) пройден | `restock()` ИЛИ `disposition='destroy'` (если контролируемое вещество/чек-лист не пройден), событие `ReturnConfirmedEvent` | **SRS-DOM-124** [REQ-RET-3/4/8] |
| `returned_to_pharmacy` | `return_rejected` | `pharmacist` | чек-лист провален без права restock (например, подозрение на подмену товара) | Событие `ReturnRejectedEvent`, заказ НЕ рефандится автоматически | **SRS-DOM-125** |
| `return_rejected` | `return_confirmed` | `pharmacy_admin`/`super_admin` | `admin_return_override(reason)` | Ручной restock/рефанд по решению администратора | **SRS-DOM-126** [REQ-RET-9/13] |
| `return_rejected` | `return_in_transit` | диспетчер | повторная попытка (`retryTransit`) | Новый курьерский рейс, append-only история | **SRS-DOM-127** [REQ-RET-13] |

**Запрещённые переходы (SRS-DOM-128):** `return_confirmed → *` (терминален); прямой переход
`return_requested → returned_to_pharmacy` минуя `return_in_transit`; `return_in_transit →
return_confirmed` минуя `returned_to_pharmacy` (обязательна физическая сдача + чек-лист).

### 5. `dispute_status`

```
   open ⇄ awaiting_customer
     │         │
     └────┬────┘
          ▼
   ┌──────────────┬───────────────────┬──────────────────────┐
   ▼              ▼                   ▼                      ▼
resolved_reject resolved_refund_full resolved_refund_partial resolved_adjustment (только post-payout)
```

| Из | В | Кто может | При каком условии | Что происходит | SRS |
|---|---|---|---|---|---|
| — | `open` | система (атомарно из `support_tickets.is_escrow_blocking=true`) | ровно один нетерминальный спор на `order_id` | `payout_schedule.status='disputed'` (SRS-DOM-105) | **SRS-DOM-129** [REQ-DISPUTE-2/3] |
| `open` | `awaiting_customer` | `support_agent`/`super_admin` | требуется доп. информация от клиента | Пауза `resolution_due_at` (REQ-DISPUTE-15) | **SRS-DOM-130** |
| `awaiting_customer` | `open` | система | клиент ответил | Возобновление отсчёта `resolution_due_at` | **SRS-DOM-131** |
| `open`/`awaiting_customer` | `resolved_reject` | `super_admin` (не `support_agent` для `refund_*`, но `resolved_reject` может и `support_agent`) | непустой `resolution_reason`; конкретное опровержение evidence при `order_item_damaged_or_expired`/`order_quality_defect` (REQ-DISPUTE-12) | `payout_schedule → due` (SRS-DOM-106) | **SRS-DOM-132** [REQ-DISPUTE-5] |
| `open`/`awaiting_customer` | `resolved_refund_full` | `super_admin` | ниже `dispute_auto_refund_threshold_dirams` — может и `support_agent` (ASSUMPTION 15000 дирам, ОВ.23) | `EscrowLedger.refund`, `payout_schedule → reversed` | **SRS-DOM-133** [REQ-DISPUTE-6, REQ-DISPUTE-9] |
| `open`/`awaiting_customer` | `resolved_refund_partial` | `super_admin` (никогда `support_agent`, REQ-DISPUTE-9) | `resolution_amount_dirams` задан и `≤ order.total` | `EscrowLedger.partiallyRefund`, `payout_schedule.amount -= X` | **SRS-DOM-134** [REQ-DISPUTE-7] |
| `open`/`awaiting_customer` | `resolved_adjustment` | `super_admin` ТОЛЬКО | `payout_schedule.status='paid'` уже (пост-payout) | `escrow_ledger.adjustment`, зачёт в следующий payout | **SRS-DOM-135** [REQ-DISPUTE-8/9] |

**Запрещённые переходы (SRS-DOM-136):** `resolved_* → *` (все четыре терминальны — «переоткрытие»
спора создаёт НОВЫЙ `OrderDispute`, если это допустимо политикой, не мутирует старый); истечение
`resolution_due_at` НЕ переводит статус автоматически — только повышает приоритет и алертит
`super_admin` (REQ-DISPUTE-14); `pharmacy_admin`/`pharmacist` своей же сети не может быть актором
любого перехода в `resolved_*` (REQ-DISPUTE-10, SRS-DOM-061).

### 6. `delivery_assignment_status`

```
 unassigned ──assign(courier)──> assigned ──depart──> en_route_to_pharmacy ──scan+load──> picked_up_from_pharmacy
                                     │                                                            │
                                     │ reassign (любая стадия до delivered)                       │
                                     ▼                                                             ▼
                                 unassigned                                              en_route_to_customer
                                                                                                    │
                                                                       ┌────────────────────────────┼──────────────┐
                                                                       ▼                                          ▼
                                                                  delivered (OTP verified)                    delivery_failed
                                                                   (terminal)                          (→ returns context, SRS-DOM-096)
```

| Из | В | Кто может | При каком условии | Что происходит | SRS |
|---|---|---|---|---|---|
| `unassigned` | `assigned` | алгоритм подбора / диспетчер | заказ в `processing`, курьер прошёл guard тенантности (SRS-DOM-037) и cold-chain (SRS-DOM-038) | Событие `CourierAssignedEvent` | **SRS-DOM-137** [REQ-DELIV-2, REQ-COUR-1/9] |
| `assigned`/`en_route_*`/`picked_up_from_pharmacy` | `unassigned` | диспетчер/`super_admin` | `reassign(reason)` | Курьер снимается, алгоритм подбирает нового | **SRS-DOM-138** [REQ-DELIV-2] |
| `assigned` | `en_route_to_pharmacy` | `courier` | явное действие в приложении («Выехал») | — | **SRS-DOM-139** |
| `en_route_to_pharmacy` | `picked_up_from_pharmacy` | `courier`+`pharmacist` | заказ переведён в `order.status='picked_up'` (SRS-DOM-094), OTP сгенерирован | — | **SRS-DOM-140** |
| `picked_up_from_pharmacy` | `en_route_to_customer` | `courier` | явное действие («В пути к клиенту») | Live-tracking активен (деградирует вне фокуса — REQ-PWA-5) | **SRS-DOM-141** |
| `en_route_to_customer` | `delivered` | `courier` | верный `OtpCode` (SRS-DOM-082) | `order.status='delivered'` (SRS-DOM-095) | **SRS-DOM-142** [REQ-DELIV-3] |
| `en_route_to_customer` | `delivery_failed` | `courier`/диспетчер | клиент недоступен/отказался после N попыток контакта (ASSUMPTION 3 попытки/30 минут) | Создаётся `OrderReturn` (SRS-DOM-096) | **SRS-DOM-143** |

**Запрещённые переходы (SRS-DOM-144):** `delivered → *` (терминален); `unassigned → en_route_*`
минуя `assigned`; `assigned → delivered` напрямую (обязателен полный маршрут через
`picked_up_from_pharmacy`/`en_route_to_customer`).

### 7. `sync_batch_status` (`inventory_sync_batches.status`)

```
 queued ──worker picks up──> processing ──all rows validated──┬──> completed_full_success
                                    │                          ├──> completed_partial_success (partial_success, REQ-SYNC-9)
                                    │                          └──> failed_validation (batch-level reject, напр. невалидный JSON)
                                    │
                          sync_type='full' AND все страницы приняты
                                    ▼
                          zeroing_missing_positions (только для full)
                                    │
                                    ▼
                          completed_full_success
```

| Из | В | Кто может | При каком условии | Что происходит | SRS |
|---|---|---|---|---|---|
| — | `queued` | система (HTTP-приёмник) | запрос прошёл auth (`X-Pharmacy-API-Key`+HMAC, D-11) и базовую схему-валидацию | Немедленный ACK клиенту (REQ-SYNC-12), `batch_id` возвращён | **SRS-DOM-145** [REQ-SYNC-1/12] |
| `queued` | `processing` | worker (BullMQ) | джоба взята из очереди `inventory_sync_queue` | Построчная обработка через `IngestInventoryBatchUseCase` (D-12) | **SRS-DOM-146** [REQ-SYNC-4] |
| `processing` | `completed_full_success` | система | все строки применены без ошибок (и, если `sync_type='full'`, выполнено обнуление отсутствующих позиций) | Событие `InventorySyncBatchCompletedEvent` | **SRS-DOM-147** [REQ-SYNC-3/9] |
| `processing` | `completed_partial_success` | система | ≥1 строка отклонена (`inventory_sync_errors`), но батч в целом принят | Ответ `partial_success` со счётчиками (REQ-SYNC-9), событие `InventorySyncBatchCompletedEvent` (флаг `hasErrors=true`) | **SRS-DOM-148** [REQ-SYNC-9] |
| `processing` | `failed_validation` | система |批ch-уровневая ошибка (невалидный JSON, превышен лимит 1000 позиций/5МБ — REQ-SYNC-4) | Ничего не применено, событие `InventorySyncBatchFailedEvent` | **SRS-DOM-149** [REQ-SYNC-4] |

**Запрещённые переходы (SRS-DOM-150):** любой `completed_*`/`failed_validation → *` (все три
терминальны — повторная попытка = новый `batch_id`); `queued → completed_*` напрямую, минуя
`processing`.

---

## Доменные события

> Гарантия доставки — **transactional outbox** (Часть C п.14 решений архитектора): доменное
> изменение и вставка строки в `outbox` происходят в ОДНОЙ транзакции БД; отдельный
> `OutboxRelayWorker` (BullMQ, `apps/worker`) читает необработанные строки и публикует в очередь
> `domain-events`, помечая `outbox.processed_at`. Идемпотентность потребителя — по `event_id` (UUID
> v7, монотонный) через таблицу `processed_events(consumer_name, event_id) UNIQUE` — обработчик
> обязан быть безопасен для повторного вызова с тем же `event_id` (at-least-once delivery).

| Событие | Payload (ключевые поля) | Публикует | Потребляет | Идемпотентность |
|---|---|---|---|---|
| `OrderPaidEvent` | `orderId, tenantId, paidAt, paymentMethod, holdAmountDiram, txId` | payments (после webhook) | orders (обновление статуса), notifications, analytics | `event_id` + `orderId` (одно событие на успешный webhook, дедуп по `payment_operations.idempotency_key`) |
| `OrderProcessingStartedEvent` | `orderId, pharmacistId, slaDeadlineAt` | orders | notifications (SLA-таймер UI), analytics | `event_id` |
| `OrderPickedUpEvent` | `orderId, handoverOtpIssuedAt, sealedBagConfirmed` | orders | delivery, notifications | `event_id`; delivery проверяет отсутствие уже созданного `DeliveryAssignment` для `orderId` (SRS-DOM-036) |
| `OrderDeliveredEvent` | `orderId, deliveredAt, courierId, otpVerifiedAt` | delivery | orders, payments, billing, analytics | `event_id`; payments проверяет отсутствие уже существующей `capture`-записи для `orderId` (SRS-DOM-032 — метод атомарен, повторный вызов no-op) |
| `OrderCancelledEvent` / `OrderAutoCancelledEvent` | `orderId, reason, cancelledBy, refundIssued: boolean` | orders | payments (если требуется рефанд), inventory (release), notifications | `event_id` |
| `OrderRefundedEvent` | `orderId, amountDiram, refundTxId, reason` | payments | orders, billing, analytics | `event_id`; повторная публикация с тем же `refundTxId` — no-op |
| `EscrowFeeCapturedEvent` | `orderId, commissionDiram, netDiram, commissionBps` | payments | billing, analytics | `event_id` |
| `PayoutDueEvent` / `PayoutPaidEvent` / `PayoutHeldEvent` / `PayoutReleasedEvent` | `orderId, payoutScheduleId, statusFrom, statusTo, amountDiram` | payments | notifications (`pharmacy_admin`), analytics | `event_id` |
| `PrescriptionOcrRequestedEvent` | `prescriptionId, customerId, fileRef` | prescriptions | (внутренний, worker OCR-джобы) | `event_id`; worker дедуплицирует по `prescriptionId` (одна активная OCR-джоба на рецепт) |
| `PrescriptionAutoMatchedEvent` / `PrescriptionNeedsClarificationEvent` / `PrescriptionRejectedEvent` / `PrescriptionVerifiedEvent` | `prescriptionId, customerId, compositeConfidence?, matchedMedicineIds?` | prescriptions | notifications, orders (разблокировка Rx-checkout), analytics | `event_id` |
| `InventorySyncBatchCompletedEvent` / `InventorySyncBatchFailedEvent` | `batchId, pharmacyId, syncType, acceptedCount, rejectedCount` | inventory | notifications (`pharmacy_admin` — история синхронизаций), catalog (индексация поиска), analytics | `event_id` + `batchId` (одно финальное событие на батч) |
| `UnmatchedInventoryRowEvent` | `pharmacyId, rawRowPayload, reason` | inventory | moderation (создание `catalog_match_queue`) | `event_id` + хеш `(pharmacyId, internal_sku)` — не дублирует запись очереди при повторном приходе той же несопоставленной строки |
| `NewControlCategoryCandidateEvent` | `medicineId, suggestedCategory, source` | catalog | moderation | `event_id` |
| `CourierAssignedEvent` | `orderId, deliveryAssignmentId, courierId` | delivery | notifications (курьеру и клиенту), analytics | `event_id` |
| `DeliveryCompletedEvent` | `deliveryAssignmentId, courierId, orderId, completedAt` | delivery | billing (`courier_earnings`, REQ-COUR-5) | `event_id` + `idempotency_key` на уровне `courier_earnings` (REQ-COUR-5: обязательный `idempotency_key`) |
| `ReturnRequestedEvent` / `ReturnArrivedAtPharmacyEvent` / `ReturnConfirmedEvent` / `ReturnRejectedEvent` | `returnId, orderId, status, disposition?` | returns | inventory (restock), payments (рефанд), delivery (курьерский рейс), disputes (post-delivery claim link), analytics | `event_id`; `restock` дополнительно идемпотентен по `orderId` (SRS-DOM-023) |
| `DisputeOpenedEvent` / `DisputeResolvedEvent` | `disputeId, orderId, status, resolutionReason?, resolvedByUserId?` | disputes | payments (`payout_schedule` статус), notifications, analytics | `event_id` |
| `SlaBreachedEvent` (delivery/dispute резолюции) | `entityType, entityId, breachedAt, slaMinutes` | disputes/orders (общий) | notifications, disputes (авто-эскалация приоритета, REQ-DISPUTE-14) | `event_id` |
| `PharmacySuspendedEvent` / `PharmacyActivatedEvent` / `PharmacyChainActivatedEvent` | `pharmacyId/chainId, reason?, actorId?` | onboarding | orders (каскадная отмена `pending_payment`/`confirmed`, REQ-ONBOARD-13, D-25), catalog/inventory (видимость в поиске), notifications | `event_id` |
| `LicenseExpiringSoonEvent` / `LicenseExpiredAutoSuspendEvent` | `pharmacyId, expiryDate, daysRemaining` | onboarding (джоба) | notifications | `event_id` + `(pharmacyId, daysRemaining)` — не дублирует одно и то же напоминание в тот же день |
| `TenantBrandingUpdatedEvent` | `tenantId, updatedFields` | tenancy | (кэш-инвалидация presentation, вне доменного слоя) | `event_id` |

**SRS-DOM-151** [Charter §5, `02` §2.6] Given любое доменное событие, When агрегат его порождает,
Then событие добавляется в тот же `unitOfWork`, что и изменение состояния агрегата (запись в
`outbox` в одной транзакции с записью в целевую таблицу); публикация в очередь происходит СТРОГО
после коммита транзакции, никогда до.

**SRS-DOM-152** Given `OutboxRelayWorker` падает после публикации в очередь, но до
`outbox.mark_processed()`, When worker перезапускается, Then событие публикуется повторно
(at-least-once) — каждый потребитель обязан быть идемпотентен по `event_id`, а не полагаться на
ровно однократную доставку.

---

## Доменные ошибки

> Иерархия — в `domain/errors/*.error.ts` каждого модуля, базовый класс `DomainError` — в
> `packages/contracts` (или общем `libs/domain-kernel`, если заведён) — **не** `HttpException`.
> Маппинг domain error → HTTP-код и `error.code` (enum `packages/contracts`) — обязанность
> `presentation`-слоя (единый `DomainExceptionFilter`), формат ответа — `{ error: { code, message,
> details? } }` (Charter §5).

```
DomainError (abstract)
├── ValidationError                     → 400 VALIDATION_ERROR
│   ├── InvalidPhoneNumberFormatError   → 400 INVALID_PHONE_FORMAT
│   ├── InvalidCoordinatesError         → 400 INVALID_COORDINATES
│   ├── OrderTotalMismatchError         → 400 ORDER_TOTAL_MISMATCH
│   ├── OrderPharmacyMismatchError      → 400 ORDER_PHARMACY_MISMATCH (SRS-DOM-002)
│   ├── InvalidRestockQuantityError     → 400 INVALID_RESTOCK_QUANTITY
│   ├── InvalidPriceError               → 400 INVALID_PRICE
│   ├── MissingResolutionReasonError    → 400 MISSING_RESOLUTION_REASON
│   └── AmbiguousDateFormatError        → 400 AMBIGUOUS_DATE_FORMAT (REQ-SYNC-15)
├── ConflictError                       → 409 CONFLICT
│   ├── DuplicateTenantSlugError        → 409 TENANT_SLUG_TAKEN
│   ├── DuplicateCustomDomainError      → 409 DOMAIN_TAKEN
│   ├── DuplicateActiveReturnError      → 409 RETURN_ALREADY_ACTIVE
│   ├── DuplicateNonTerminalDisputeError→ 409 DISPUTE_ALREADY_ACTIVE
│   └── LedgerImbalanceError            → 409 LEDGER_IMBALANCE (алерт, не пользовательский путь)
├── NotFoundError                       → 404 NOT_FOUND
│   └── (конкретизируется на уровне application: MedicineNotFoundError, OrderNotFoundError, ...)
├── ForbiddenTransitionError (базовый) → 409 INVALID_STATE_TRANSITION
│   ├── InvalidOrderStatusTransitionError
│   ├── InvalidPrescriptionTransitionError
│   ├── InvalidOnboardingTransitionError
│   ├── AutomaticReactivationForbiddenError
│   └── DisputeAfterPayoutRequiresAdjustmentError
├── BusinessRuleViolationError (базовый) → 422 BUSINESS_RULE_VIOLATION
│   ├── PrescriptionNotVerifiedError     → 422 PRESCRIPTION_NOT_VERIFIED (REQ-REG-2)
│   ├── ControlledSubstanceNotOrderableError → 422 CONTROLLED_SUBSTANCE_FORBIDDEN (D-08)
│   ├── ExpiredStockError                → 422 EXPIRED_STOCK (REQ-REG-6)
│   ├── CodForbiddenForRxError           → 422 COD_FORBIDDEN_FOR_RX (D-16)
│   ├── CodLimitExceededError            → 422 COD_LIMIT_EXCEEDED (D-16)
│   ├── InsufficientStockError           → 422 INSUFFICIENT_STOCK
│   ├── RestockConditionsNotMetError     → 422 RESTOCK_CONDITIONS_NOT_MET (REQ-RET-3)
│   ├── ControlledSubstanceMustBeDestroyedError → 422 CONTROLLED_SUBSTANCE_MUST_BE_DESTROYED (REQ-RET-4)
│   ├── ParentChainNotActiveError        → 422 PARENT_CHAIN_NOT_ACTIVE (REQ-ONBOARD-10)
│   ├── PharmacySuspendedError           → 403 PHARMACY_SUSPENDED (REQ-ONBOARD-12)
│   ├── CashAmountMismatchError          → 422 CASH_AMOUNT_MISMATCH (REQ-DELIV-4)
│   ├── CourierTenantMismatchError       → 403 COURIER_TENANT_MISMATCH (REQ-COUR-1)
│   ├── CourierNotEligibleError          → 422 COURIER_NOT_ELIGIBLE (REQ-COUR-9)
│   ├── SelfDealingResolutionError       → 403 SELF_DEALING_FORBIDDEN (REQ-DISPUTE-10)
│   ├── TenantConfirmationPendingError   → 409 TENANT_CONFIRMATION_PENDING (REQ-DISPUTE-11)
│   └── DisputeHoldViolationError        → 409 PAYOUT_ON_HOLD (D-24)
├── SecurityError (базовый)             → 401/403
│   ├── InvalidWebhookSignatureError    → 401 INVALID_WEBHOOK_SIGNATURE (REQ-PAY-2)
│   ├── ConsentNotGivenError            → 400 CONSENT_REQUIRED (REQ-REG-9)
│   └── UnauthorizedAdjustmentError     → 403 UNAUTHORIZED_ADJUSTMENT (REQ-DISPUTE-9)
├── OtpError (базовый)                  → 400/423
│   ├── OtpExpiredError                 → 400 OTP_EXPIRED
│   ├── OtpMismatchError                → 400 OTP_MISMATCH
│   └── OtpAttemptsExceededError        → 423 OTP_LOCKED (REQ-DELIV-3)
└── ExternalIntegrationError (базовый, application-уровень, не domain) → 502/503
    ├── PaymentProviderUnavailableError → 503 PAYMENT_PROVIDER_UNAVAILABLE (Charter §7, circuit breaker)
    ├── OcrProviderUnavailableError     → 503 OCR_PROVIDER_UNAVAILABLE
    └── SmsProviderUnavailableError     → 503 SMS_PROVIDER_UNAVAILABLE
```

**SRS-DOM-153** [Charter §5, `02` §2.5] Given любая доменная ошибка, When она долетает до
`presentation`, Then единственный `DomainExceptionFilter` матчит класс ошибки на HTTP-код из таблицы
выше и формирует `{ error: { code, message, details? } }`; ни один контроллер не содержит
собственного `try/catch` с ручным маппингом кода (иначе — дублирование правил, дефект code review).

---

## Доменные политики

> Политики авторизации/бизнес-правил живут в `application/policies/*.policy.ts` (`02` §3.4:
> «авторизация — политика в application, в guard'ах — только аутентификация и грубая проверка
> роли»).

**SRS-DOM-154 — Отмена заказа** [REQ-DELIV-5, D-09] Given заказ в статусе `pending_payment` или
`confirmed` (D-25) или `paid_escrow` или `processing` (товар физически ещё не покинул аптеку), When
`customer` или `pharmacist`/`pharmacy_admin` вызывает отмену, Then отмена разрешена без ограничений
(полный рефанд через `PaymentProvider.refund()`/`EscrowLedger.refund`, если уже оплачен через
эскроу; **для `confirmed` — рефанд НЕ вызывается**, т.к. `escrow_ledger` для наличных заказов не
создаётся, — только освобождение резерва остатка, D-25). Given заказ в `picked_up` (товар уже вне
аптеки), When инициируется прекращение доставки, Then это **не отмена**, а `OrderReturn` с веткой
«до вручения» (SRS-DOM-096) — `OrderPolicy.canCancel(order)` возвращает `false` для
`picked_up`/`delivered`/терминальных статусов.

**SRS-DOM-155 — Видимость рецепта** [REQ-REG-10, REQ-REG-11] Given `prescription_image_url`
(файл в MinIO), When любая роль запрашивает доступ, Then доступ разрешён ТОЛЬКО: (а) `customer` —
владелец рецепта, к своему файлу; (б) `pharmacist`, которому заказ, содержащий этот рецепт, назначен
в текущей или предшествующей смене (проверка `order.pharmacyId === actor.pharmacyId` И заказ
ссылается на этот `prescriptionId`); (в) `super_admin` — с обязательной записью в `audit_log`
(REQ-REG-10) на каждый просмотр. `pharmacy_admin` НЕ имеет доступа к содержимому изображения по
умолчанию (только к метаданным статуса) — предотвращает избыточный доступ к медданным.

**SRS-DOM-156 — Когда разрешён COD (`cash_courier`)** [D-16] `PolicyResult.isCodAllowed(order)` =
`false`, если: (а) заказ содержит ≥1 позицию с `is_prescription_required = true`; ИЛИ (б)
`order.totalAmountDiram > tenantSettings.codLimitDiram` (дефолт 50000 дирам = 500 TJS,
per-tenant конфигурируемо). Иначе — `true`.

**SRS-DOM-157 — Когда запрещена дистанционная продажа (`control_category`)** [D-08, REQ-REG-4/5]
Given `medicine.controlCategory ∈ {'psychotropic', 'narcotic'}`, Then товар НИКОГДА не может попасть
ни в один `Order` (жёсткий инвариант конструктора `Order`, SRS-DOM-005) и исключается из выдачи
поиска/каталога API целиком (не только скрыт в UI — фильтр на уровне `CatalogFacade.search()`), из
рекламных/акционных блоков и из индексации SEO. Given `controlCategory = 'potent'`
(сильнодействующее, но не наркотическое/психотропное), Then продажа РАЗРЕШЕНА, но обязательна
`is_prescription_required = true` (SRS-DOM-015) — товар заказываем, но только с верифицированным
рецептом, без специальной рекламы (REQ-REG-19/20).

**SRS-DOM-158 — Правила подбора аналога** [D-07, REQ-NORM-1/2, REQ-MARKET-3] Препарат `B` считается
аналогом препарата `A`, если И ТОЛЬКО ЕСЛИ: (1) множество `{substanceId}` идентично (не подмножество,
не пересечение — точное совпадение множеств действующих веществ, включая комбинированные препараты,
D-07); (2) `A.dosageForm.isEquivalentTo(B.dosageForm)` (тот же укрупнённый класс формы, SRS-DOM-079);
(3) для каждого совпадающего вещества `A.medicineSubstances[substance].strength.isEquivalentTo
(B...)` (точное совпадение дозировки после конвертации единиц, SRS-DOM-078). Сравнение `inn_name`
как единственной строки — **запрещено** как достаточное условие (может ложно объединить/разделить
комбинированные препараты). Список аналогов сортируется по `pi.price ASC` (сохраняя формулировку
tz.log §II.3, но через `substances`, а не `inn_name =`).

**SRS-DOM-159 — Расчёт экономии** [REQ-MARKET-3] `savingsDiram = referenceMedicine.displayPrice -
cheapestAnalog.displayPrice`, где `referenceMedicine` — товар, изначально найденный пользователем (не
обязательно самый дорогой в списке аналогов), `cheapestAnalog` — минимальная цена среди найденных
аналогов с `stock_quantity > 0` в радиусе поиска пользователя. Значение НЕ округляется до «вменяемых»
чисел — отображается точно, включая разбросы вплоть до ×9.8–10 (REQ-MARKET-3, research 01 §3).
Если `savingsDiram <= 0` (аналог не дешевле), блок экономии не показывается (UI-правило, не
доменное, но фиксируется здесь как источник для presentation).

**SRS-DOM-160 — Комиссия платформы: резолвинг ставки** [D-03, REQ-MON-8] Ставка `commission_bps`
резолвится по специфичности на момент `Order.create()`: `(tenant_id, chain_id, category) >
(tenant_id, chain_id) > (tenant_id, category) > (tenant_id) > global_default`. Дефолты (ASSUMPTION,
подлежат утверждению заказчиком, D-03): Rx — 500 bps (5%), ОТС — 800 bps (8%), парафармация/БАД —
1200 bps (12%) от `items_total`. Явное правило в `commission_rates` с более узкой специфичностью
всегда побеждает более общее, независимо от порядка вставки в таблицу (даты действия — доп.
фильтр: правило должно быть активно на дату заказа).

**SRS-DOM-161 — Приостановка аптеки и судьба открытых заказов** [REQ-ONBOARD-13/14] Given
`PharmacyAccount.suspend(reason, actor)`, When `reason ∉ {'fraud_or_safety', 'license_revoked'}`,
Then заказы в `pending_payment` переводятся в `cancelled` (SRS-DOM-090), заказы в `confirmed`
переводятся в `cancelled` без рефанда (D-25 — аналогично `pending_payment`: оплаты как финансового
факта ещё нет), заказы в `paid_escrow`/`processing`/`picked_up` продолжают штатный жизненный цикл
без изменений. Given
`reason ∈ {'fraud_or_safety', 'license_revoked'}`, Then требуется ОТДЕЛЬНОЕ явное действие
`super_admin` — `ForceCancelIncompleteOrdersUseCase` — с полным `PaymentProvider.refund()` для ВСЕХ
незавершённых заказов этой аптеки; это не побочный эффект самого `suspend()`.

**SRS-DOM-162 — Частичный рефанд при неподдержке провайдером** [D-10, REQ-RET-6] Given
`PaymentProvider.capabilities().supportsPartialRefund === false` (MVP-дефолт для Mock/Alif-профиля,
research 08-3 §7.2), When требуется частичный возврат (например, возврат части позиций заказа), Then
применяется стратегия **раздельного биллинга**: `items_total` и `delivery_fee` изначально проводятся
как отдельные транзакции через `Money.allocate()` (SRS-DOM-066), что делает частичный возврат `items`
технически полным возвратом одной из двух транзакций. Если раздельный биллинг не был применён при
оформлении заказа (публикуется через `capability`-флаг, дизайн-решение фиксируется на уровне
`CheckoutUseCase`, не адаптера), — резервная стратегия: полный (100%) `refund()` + аналитическая
запись `escrow_ledger.entry_type='adjustment'` на недополученную сумму (MVP-дефолт по ОВ.25).

**SRS-DOM-163 — Netting после `paid`** [REQ-DISPUTE-8, ОВ.24] Спор, открытый после
`payout_schedule.status='paid'`, не имеет прямого технического отката — обрабатывается
исключительно через `resolveAdjustment` (SRS-DOM-063), а зачёт производится в СЛЕДУЮЩИЙ расчётный
период выплаты той же аптеки (`payout_schedule`-джоба обязана проверять наличие незачтённых
`adjustment`-записей и вычитать их сумму перед формированием новой выплаты). Юридическое основание
для одностороннего удержания будущей выплаты — предмет договора с аптечной сетью (открытый вопрос,
не блокирует реализацию механизма зачёта).

---

## Пограничные случаи и ошибки

**SRS-DOM-164 — Дублирующийся webhook оплаты** [REQ-PAY-3] Given банк повторно шлёт тот же
`PAID_HOLD`-вебхук (сетевой ретрай в течение ~1 часа), When `PaymentsFacade.handleWebhook()`
получает запрос с уже известным `payment_operations.idempotency_key`, Then обработчик возвращает
`200 OK` немедленно БЕЗ повторного вызова `EscrowLedger.recordHold()` — проверка идемпотентности
происходит ДО начала бизнес-логики (`UNIQUE` constraint на `idempotency_key` + upsert-паттерн «select
or insert-then-check»).

**SRS-DOM-165 — Гонка: два вебхука для разных заказов одновременно** [REQ-PAY-3] Given два вебхука
разных `orderId` приходят конкурентно, When оба обрабатываются, Then каждый — в своей транзакции
БД со своим `SELECT ... FOR UPDATE` на строку `orders`/`payout_schedule` — блокировка построчная,
не глобальная, не создаёт узкое место для несвязанных заказов.

**SRS-DOM-166 — Таймаут провайдера оплаты при создании счёта** [Charter §7, circuit breaker] Given
`PaymentProvider.createBill()` не отвечает в течение `PAYMENT_PROVIDER_TIMEOUT_MS` (ASSUMPTION 8000),
When вызов из `CheckoutUseCase`, Then заказ остаётся в `pending_payment` без созданного
`payment_transaction_id`, клиенту возвращается `503 PAYMENT_PROVIDER_UNAVAILABLE`, способ оплаты
скрывается в UI при открытом circuit breaker (REQ-PAY-12) — заказ НЕ считается неудачным
перманентно, клиент может повторить попытку (idempotency-ключ на попытку — `checkout_attempt_id`,
не `order_id`, чтобы не создавать дублирующиеся заказы при ретрае).

**SRS-DOM-167 — Отсутствие сети у фармацевта при сканировании** [REQ-UX-11] Given терминал
фармацевта офлайн в момент сканирования штрихкода, When фармацевт продолжает сканировать позиции,
Then сканы буферизуются в IndexedDB клиента; при восстановлении сети — досылка пакетом; SLA-таймер
(7 мин) продолжает отсчёт от `order.processing_started_at`, НЕ приостанавливается из-за офлайна
клиента (сервер — источник истины времени, не клиентские часы).

**SRS-DOM-168 — Дубль батча 1С-синхронизации** [REQ-SYNC-1] Given 1С повторно отправляет тот же
`batch_id` (сетевой ретрай на стороне 1С), When `IngestInventoryBatchUseCase` получает запрос, Then
проверяется `inventory_sync_batches.batch_id UNIQUE` — при конфликте возвращается СОХРАНЁННЫЙ ранее
результат обработки (тот же `partial_success`/`full_success` ответ), повторно бизнес-логика не
исполняется.

**SRS-DOM-169 — Устаревшая строка внутри батча** [REQ-SYNC-11] Given строка батча содержит
`sync_timestamp` старше уже сохранённого `pharmacy_inventory_batch.last_synced_at` для того же
`(pharmacy_id, internal_sku)`, When обрабатывается батч, Then строка помечается `skipped_stale` в
`inventory_sync_errors` (не как ошибка данных — как ожидаемый штатный случай), остальные строки
батча обрабатываются нормально (SRS-DOM-022).

**SRS-DOM-170 — Гонка: возврат и ночная full-синхронизация** [REQ-RET-8, риск из дайджеста] Given
`OrderReturn.confirmReceived()` выполняет `restock()` ПОЧТИ ОДНОВРЕМЕННО с ночной
`sync_type='full'`-синхронизацией той же аптеки, When обе операции применяются к одному
`(pharmacy_id, medicine_id)`, Then `restock` логируется как ОТДЕЛЬНОЕ audit-событие
(`inventory_audit_log`, не смешивается со счётчиками 1С-инкрементов), а порядок применения
определяется временными метками транзакций БД (`SELECT ... FOR UPDATE` на строку
`pharmacy_inventory`); если full-синхронизация применяется ПОСЛЕ restock и не содержит данных о
возвращённой партии (1С не знает о возврате — обратный канал не гарантирован, риск из дайджеста
п.19), результат — потенциальное расхождение, детектируемое ежедневной сверкой
(`InventoryReconciliationJob`, Should, не блокирует MVP) и алертом `pharmacy_admin`, а не автоматическим
исправлением задним числом.

**SRS-DOM-171 — Rx-заказ, рецепт отозван/испорчен после оформления** Given `Prescription.verify()`
уже выполнен и заказ создан, When впоследствии обнаруживается подделка рецепта (ручное
расследование `super_admin`), Then прямого доменного перехода «разверификации» не существует —
`super_admin` инициирует `OrderDispute`/принудительную отмену заказа через отдельный
административный use case (`AdminForceCancelOrderUseCase`) с обязательным `reason` и
`audit_log`-записью; сам `prescriptions.status` остаётся `verified` как исторический факт (что
подтверждено фармацевтом в тот момент), новое поле `prescriptions.revoked_at` фиксирует
последующий отзыв отдельно от `status` (не путать со state machine §5.3, которая уже терминальна).

**SRS-DOM-172 — OTP введён верно, но ПОСЛЕ истечения TTL на долю секунды (пограничное время)**
[REQ-DELIV-3] Given `clock.now()` строго больше `issuedAt + ttlSeconds`, When курьер вводит верный
код, Then возвращается `OtpExpiredError` — сравнение включительно `now <= issuedAt + ttl` считается
валидным, `now > issuedAt + ttl` — просрочено; `Clock`-порт — единственный источник времени (не
`Date.now()` внутри домена, `02` §2.6), что даёт детерминированные unit-тесты границы.

**SRS-DOM-173 — Курьер исчерпал попытки OTP** [REQ-DELIV-3] Given `attemptsUsed = 5`, When 6-я
попытка (любой код, включая верный), Then `OtpAttemptsExceededError` без проверки самого кода
(fail-closed) — разблокировка только через `application`-команду `ReissueHandoverOtpUseCase`,
доступную `pharmacist`/`support_agent`, с новой генерацией OTP и обнулением счётчика.

**SRS-DOM-174 — Внешний провайдер OCR недоступен** [Charter §7] Given `PrescriptionOcrProvider`
возвращает таймаут/5xx после `OCR_RETRY_ATTEMPTS` (ASSUMPTION 3, экспоненциальный backoff), When
`ocr_processing`, Then статус переходит в `rejected` с `rejection_reason='ocr_provider_unavailable'`
(не зависает бесконечно в `ocr_processing`), клиенту предлагается повторить загрузку позже —
деградация не должна блокировать весь чекаут (Rx-товары просто остаются недоступны до успешной
верификации, остальная корзина оформляется отдельно).

**SRS-DOM-175 — Дубликат действующего вещества в корзине** [REQ-SAFETY-1] Given клиент добавляет в
корзину два разных `Medicine` с пересекающимся множеством `substances`, When товар добавляется,
Then система показывает ПРЕДУПРЕЖДЕНИЕ (не блокировку) — `CartWarningEvent` на уровне application,
клиент может продолжить оформление сознательно; это единственный случай в документе, где сработавшая
проверка НЕ бросает доменную ошибку, а порождает информационное событие.

**SRS-DOM-176 — Money: попытка операции с разными валютами** Given `Money(100, 'TJS')` и
`Money(50, 'USD')` (гипотетически, MVP работает только в `TJS`, но VO должен быть безопасен на
будущее мультивалютности White-Label), When вызывается `add()`, Then `CurrencyMismatchError` — не
неявное приведение.

**SRS-DOM-177 — Барcode с длиной не 13 и не похож на внутренний SKU** [D-06] Given строка
`barcode` длиной, например, 8 символов (UPC-A вместо EAN-13), When `Barcode.parse()`, Then НЕ
бросается исключение — `format='non_ean13'`, `isValidEan13()=false`; composite-матчинг переходит к
шагу 2 (`internal_sku`) и 3 (fuzzy trigram), штрихкод сохраняется как есть для аудита/будущей
курации (не теряется, не блокирует импорт строки батча).

---

## Тестовые сценарии

> Формат: `TC-DOM-nnn` → проверяет `SRS-DOM-nnn`. Включены позитивные и негативные кейсы.
> Unit-тесты домена — без БД/сети (`02` §6: «domain/application — ≥90% покрытия, тестируется без
> инфраструктуры»).

| TC | Проверяет | Given | When | Then |
|---|---|---|---|---|
| TC-DOM-001 | SRS-DOM-004 | Корзина с Rx-товаром, `prescriptionId=null` | `Order.create(cmd)` | Возвращён `PrescriptionNotVerifiedError`, заказ не создан |
| TC-DOM-002 | SRS-DOM-004 | Rx-товар, `prescriptionId` ссылается на рецепт со статусом `needs_clarification` | `Order.create(cmd)` | `PrescriptionNotVerifiedError` (только `verified` проходит) |
| TC-DOM-003 | SRS-DOM-005 | Товар с `controlCategory='narcotic'` в корзине | `Order.create(cmd)` | `ControlledSubstanceNotOrderableError`, ни при какой роли/конфигурации исключений нет |
| TC-DOM-004 | SRS-DOM-007 | Корзина без Rx, `totalAmountDiram = 60000` (600 TJS), `payment_method='cash_courier'`, `codLimitDiram=50000` | `Order.create(cmd)` | `CodLimitExceededError` |
| TC-DOM-005 | SRS-DOM-007 | Та же корзина, `totalAmountDiram=40000` (400 TJS) | `Order.create(cmd)` | Заказ создан успешно (COD разрешён) |
| TC-DOM-006 | SRS-DOM-008 | Заказ создан с `commission_bps=500` (снэпшот) | `commission_rates` обновлена на `800` ПОСЛЕ создания заказа | Уже созданный `order_item.commission_bps` остаётся `500` |
| TC-DOM-007 | SRS-DOM-064/065 | `Money.fromDbDecimalTjs("14.50")` | вызов | Внутреннее значение `1450n` (дирам), `toDbDecimalTjs()` возвращает `"14.50"` (round-trip без потерь) |
| TC-DOM-008 | SRS-DOM-066 | `Money.fromDiram(100n).allocate([1,1,1])` (раздел на 3 равные доли, 100 не делится нацело на 3) | вызов | Результат `[34n,33n,33n]` (largest remainder), `Σ = 100n` точно |
| TC-DOM-009 | SRS-DOM-074 | Штрихкод `4601964000125` (из примера tz.log) | `Barcode.parse(...)` | `isValidEan13()===true` (контрольная цифра верна) |
| TC-DOM-010 | SRS-DOM-074 | Штрихкод `4601964000126` (та же строка, последняя цифра испорчена) | `Barcode.parse(...)` | `isValidEan13()===false`, исключение НЕ бросается |
| TC-DOM-011 | SRS-DOM-075 | Штрихкод `2001234567890` (префикс `2`) | `Barcode.parse(...).isInternalPrefix()` | `true` — не используется как единственный ключ матчинга |
| TC-DOM-012 | SRS-DOM-078 | `Dosage("500 мг")` vs `Dosage("0.5 г")` | `isEquivalentTo()` | `true` (конвертация в базовую единицу mg: 500 == 500) |
| TC-DOM-013 | SRS-DOM-078 | `Dosage("500 мг")` vs `Dosage("500 ЕД")` | `isEquivalentTo()` | `false` (разные семейства единиц — масса vs активность) |
| TC-DOM-014 | SRS-DOM-158 | Два комбинированных препарата с частично пересекающимся, но не идентичным множеством веществ (например, парацетамол+кофеин vs парацетамол+кодеин) | Запрос блока аналогов | Второй препарат НЕ входит в список аналогов первого |
| TC-DOM-015 | SRS-DOM-082 | `OtpCode(purpose='delivery_handover')`, 4 неверные попытки | 5-я попытка с ВЕРНЫМ кодом | Успех, OTP потреблён |
| TC-DOM-016 | SRS-DOM-082/173 | То же, но 5 неверных попыток уже использовано | 6-я попытка с верным кодом | `OtpAttemptsExceededError`, код не проверяется |
| TC-DOM-017 | SRS-DOM-172 | `issuedAt=T`, `ttlSeconds=900`, `clock.now()=T+900` (ровно граница) | `verify(validCode)` | Успех (включительно) |
| TC-DOM-018 | SRS-DOM-172 | `clock.now()=T+901` | `verify(validCode)` | `OtpExpiredError` |
| TC-DOM-019 | Order state machine (SRS-DOM-089..102, 178..180) | Заказ в `delivered` | `order.markPaidEscrow(...)` | `InvalidOrderStatusTransitionError` (запрещённый переход `delivered→paid_escrow`) |
| TC-DOM-019a | SRS-DOM-180 [D-25] | Заказ создан с `payment_method='cash_courier'` (статус `confirmed`) | Запрос `escrow_ledger` по `orderId` | Пусто (0 записей); попытка `order.markPaidEscrow(...)` из `confirmed` → `InvalidOrderStatusTransitionError` (`confirmed→paid_escrow` запрещён, SRS-DOM-102) |
| TC-DOM-019b | SRS-DOM-180 [D-25] | Заказ в `paid_escrow` (запись `hold` в `escrow_ledger` создана атомарно с переходом, SRS-DOM-089) | Прямая выборка `order.status` и `escrow_ledger` для `orderId` | `status='paid_escrow'` И `escrow_ledger` содержит ≥1 запись — обратное (статус `paid_escrow` без записей) недостижимо ни при каком сценарии |
| TC-DOM-020 | Order state machine | Заказ в `cancelled` | `order.startProcessing(...)` | `InvalidOrderStatusTransitionError` (терминальный статус) |
| TC-DOM-021 | SRS-DOM-094 | Заказ в `processing`, партия с `expiry_date = today - 1 день` среди отсканированных | `order.markPickedUp(...)` | `ExpiredStockError`, переход не выполнен |
| TC-DOM-022 | SRS-DOM-031/032 | `EscrowLedger` для заказа | `ledger.captureOnDelivery(commission, net)` вызван дважды подряд (повторная доставка события) | Вторая запись НЕ создаётся повторно (идемпотентность по `orderId`+`entry_type`), баланс не искажён |
| TC-DOM-033-ren | SRS-DOM-033 | Ledger с `hold=10000`, `platform_fee_captured=800`, `captured_to_pharmacy=9200` | `isBalanced()` | `true` (10000 = 800+9200+0) |
| TC-DOM-023 | SRS-DOM-033 | Ledger с `hold=10000`, `platform_fee_captured=800`, `captured_to_pharmacy=9000` (потеряно 200) | `isBalanced()` | `false` — алерт реконсиляции |
| TC-DOM-024 | SRS-DOM-034 | `payout_schedule.status='disputed'` | `ledger.refund(...)` (не через adjustment) | `DisputeHoldViolationError` |
| TC-DOM-025 | SRS-DOM-057 | Заказ уже имеет открытый (`open`) `OrderDispute` | Повторный `OrderDispute.open(...)` для того же `orderId` | `DuplicateNonTerminalDisputeError` |
| TC-DOM-026 | SRS-DOM-061 | Актор — `pharmacy_admin` сети, к которой относится заказ спора | `dispute.resolveReject(reason, actorId=этот pharmacy_admin)` | `SelfDealingResolutionError` |
| TC-DOM-027 | SRS-DOM-063 | `payout_schedule.status='due'` (ещё не `paid`) | `dispute.resolveAdjustment(...)` | Ошибка — adjustment доступен только после `paid`; корректный путь — `resolveRefundFull/Partial` |
| TC-DOM-028 | SRS-DOM-052 | `OrderReturn` уже в статусе `return_in_transit` для заказа | Повторный `OrderReturn.request(тот же orderId)` | `DuplicateActiveReturnError` |
| TC-DOM-029 | SRS-DOM-053/054 | Возврат товара с `controlCategory='psychotropic'`, упаковка цела, срок годности в порядке | `orderReturn.confirmReceived(...)` с попыткой `restock` | `ControlledSubstanceMustBeDestroyedError`, `disposition` принудительно `'destroy'` |
| TC-DOM-030 | SRS-DOM-053 | Возврат: упаковка вскрыта | `restock()` | `RestockConditionsNotMetError` |
| TC-DOM-031 | SRS-DOM-048 | `PharmacyAccount` пытается `activate()`, родительская `PharmacyChain.status='pending_review'` | вызов | `ParentChainNotActiveError` |
| TC-DOM-032 | SRS-DOM-049 | Активная аптека меняет `address_text` | `updateAddress(...)` | `status` переходит в `'pending_review'`, не остаётся `'active'` |
| TC-DOM-033 | SRS-DOM-050 | Аптека в `suspended` (`reason='license_expired'`) | Попытка программного авто-возврата в `active` без прохождения `pending_review` | `AutomaticReactivationForbiddenError` |
| TC-DOM-034 | SRS-DOM-085 | Первый заказ дня `260827` | `OrderNumberGeneratorPort.next()` | `DTJ-260827-00001` |
| TC-DOM-035 | SRS-DOM-085 | 100000-й заказ того же дня (`seq5` переполнен) | `next()` | `OrderNumberSequenceExhaustedError` (эксплуатационный алерт) |
| TC-DOM-036 | SRS-DOM-164 | Webhook с `idempotency_key=X` уже обработан | Повторный webhook с тем же `X` | `200 OK`, `EscrowLedger.recordHold` НЕ вызван повторно (проверяется отсутствием второй записи в ledger) |
| TC-DOM-037 | SRS-DOM-022/169 | Батч содержит строку с `sync_timestamp` старше сохранённой | Обработка батча | Строка помечена `skipped_stale` в `inventory_sync_errors`, остальные строки применены |
| TC-DOM-038 | SRS-DOM-009 | Заказ с `items_total=10000`, `delivery_fee=2000` | Расчёт `commission_dirams` при `commission_bps=500` | `500` (5% от 10000, delivery_fee не учтён), НЕ `600` |
| TC-DOM-039 | SRS-DOM-156 | Rx-товар в корзине, `payment_method='cash_courier'` запрошен | `isCodAllowed(order)` | `false` независимо от суммы заказа |
| TC-DOM-040 | SRS-DOM-175 | Корзина: два медикамента с общим действующим веществом (не идентичное множество, частичное пересечение) | Добавление второго в корзину | Заказ разрешён к оформлению, но эмитировано `CartWarningEvent` (не блокирует) |
| TC-DOM-041 (негативный, e2e-уровень) | SRS-DOM-046, D-01 | `BRAND_NAME` тенанта изменён на произвольное значение | Полный прогон UI (customer/admin) | Нигде не встречается старая захардкоженная строка бренда — соответствует e2e-требованию D-01 |
| TC-DOM-042 | SRS-DOM-133/134 (REQ-DISPUTE-9) | Актор — `support_agent`, сумма возврата выше `dispute_auto_refund_threshold_dirams` ИЛИ запрошен `resolveRefundPartial` | Вызов | Доступ запрещён на уровне application policy (`UnauthorizedAdjustmentError`/403), только `super_admin` |

---

**Итог**: документ вводит 180 требований `SRS-DOM-001..180` (инварианты, VO-правила, переходы
состояний, гарантии событий, ошибки, политики, пограничные случаи), обязательных для всех
последующих SRS-документов (Catalog/Search, Orders/Checkout, Payments/Escrow, Prescriptions/AI,
Delivery/Courier, Onboarding/Moderation, Notifications, Analytics) и для тикетов Tech Lead. Любое
расхождение нижестоящего SRS с этим документом разрешается ТОЛЬКО через ADR, а не молчаливой правкой.
