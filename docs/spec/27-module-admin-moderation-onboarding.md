# DoruTJ — Модуль: Админ-панель, модерация, онбординг аптек, уведомления, аналитика

> Владелец: Analyst (SRS). Статус: **BASELINE для фазы Analysis**.
> Приоритет источников при противоречии: `04-SCOPE-DECISION-PIVOT.md` > `03-ARCHITECT-DECISIONS.md`
> (D-*) > `00-PROJECT-CHARTER.md` (CUJ-*, §) > `research/00-RESEARCH-DIGEST.md` (REQ-*) > `tz.log`
> (§ТЗ). Документы `10-domain-model.md`, `11-database-schema.md`, `12-api-conventions-auth-tenancy.md`
> — **ЗАКОН**: сущности, поля, статусы, коды ошибок из них не переопределяются, только
> расширяются/уточняются со ссылкой (`SRS-DOM-*`, `SRS-DB-*`, `SRS-API-*`).
>
> Идентификаторы требований этого документа: **SRS-ADM-nnn**. Тестовые сценарии: **TC-ADM-nnn**.
> Каждое требование снабжено меткой релиза **[R1]**/**[R2]**/**[R3]** (`04-SCOPE-DECISION-PIVOT.md`).
> Слои — по `02-CLEAN-ARCHITECTURE-AND-CODE.md`: **domain** (инварианты, уже определены в
> `10-domain-model.md` для агрегатов `PharmacyChain`/`PharmacyAccount`/`OrderDispute`/`OrderReturn`/
> `CatalogMatchQueueItem`; в этом документе — только НОВЫЕ элементы этих слоёв, не дублируемые),
> **application** (use cases этого модуля), **infrastructure** (адаптеры уведомлений, экспорт-джобы),
> **presentation** (эндпоинты `apps/api`, экраны `apps/admin`).
>
> Бренд: ни один пример ниже не содержит хардкода имени/палитры/домена — только `tenant.brandName`/
> `--brand-*` (D-01). Денежная конвенция — как в `10-domain-model.md`: домен и application работают
> в целых дирамах (`Money`), `NUMERIC(10,2)` только на границе `infrastructure`.

---

## Разбиение по релизам

> Обоснование release-меток по каждой возможности — см. `04-SCOPE-DECISION-PIVOT.md` §3–§5.
> Правило пивота: архитектурные основания (схема, state machine, порты) закладываются в R1 целиком,
> даже если пользовательская функция включается позже (ретрофит дороже) — это явно отмечено в
> колонке «Что уже R1» ниже.

| Возможность модуля | Релиз | Обоснование |
|---|---|---|
| Онбординг сети/аптеки, верификация лицензии, приостановка/реактивация | **R1** | Прямо перечислено в `04-SCOPE-DECISION` R1-11 («аптеки и верификация лицензий, D-22»); без верификации каталог не может честно исключать неактивные аптеки (REQ-ONBOARD-11) |
| Модерация каталога (`catalog_match_queue`), создание медикамента, слияние дублей, назначение `control_category` | **R1** | R1-5 («Composite-матчинг (D-06) + очередь модерации») — без модерации приём Excel/ручных выгрузок от аптек без автоматизации (R1-5) невозможен честно |
| Админ-панель `super_admin`: тенанты (базовый CRUD), аптеки, пользователи, заказы (поиск/деталь/ручное вмешательство+аудит), финансы (ledger/payouts/комиссии), фиче-флаги | **R1** | R1-11 явно перечисляет «модерация каталога, аптеки и верификация, пользователи, заказы, финансы»; фиче-флаги нужны с первого дня, чтобы гейтить R2-4 (OCR) «фиче-флагом» (§4 пивота) |
| Полный White-Label конфигуратор брендинга (визуальный редактор палитры/лого, мастер кастом-доменов, self-service для сети) | **R3** | Явно R3-2 пивота: «White-Label UI: конфигуратор брендинга... Требует подписанного LOI/оплаченного пилота». В R1 — только программный `PATCH /tenant-settings` без визуального конструктора (см. §4.6) |
| Кабинет `pharmacy_admin`: свои аптеки, остатки/цены (обзор), заказы (обзор), сотрудники/роли, API-ключи 1С, отчёты и выплаты, расписание/зона доставки | **R1** | R1-9 прямо перечисляет весь набор |
| Полный 1С-шлюз CommerceML (мониторинг сложных сценариев дельта/полной синхронизации, отчёты об ошибках расширенного формата) | **R2** | R2-3: «Полный 1С-шлюз: CommerceML... очередь BullMQ». В R1 кабинет уже показывает историю батчей REST/Excel/ручного канала (REQ-SYNC-10) — это НЕ откладывается, откладывается только сам CommerceML-адаптер |
| `NotificationService`: Telegram (основной) + `MockSmsProvider` + web push + in-app, матрица событие×роль×канал, шаблоны tj/ru/en, дедуп, тихие часы | **R1** | R1-13 (Telegram + Mini App) и D-23 (SMS mock, web push «дополнительный» с первого дня) |
| Push-уведомления во Flutter-приложениях (`pharmacy_mobile`/`courier_mobile`) | **R2** | R2-5: «Web push и офлайн-режим для мобильных клиентов» — сами мобильные клиенты появляются в R2, инфраструктура `PushProvider` уже существует с R1 (Charter §3.3) |
| `audit_log`: обязательное логирование денег/заказов/рецептов/ролей/API-ключей | **R1** | Часть C п.13 решений архитектора, действует с первой транзакции с реальными деньгами (ledger — R1-8) |
| Продуктовая аналитика (воронка «показ экономии → клик → корзина → заказ», GMV, экономия сомони, SLA, отмены) | **R1** | R1-15: «**Обязательно.** Без этого невозможно проверить kill-критерии» пивота (§7) |
| Отчёты для аптеки/платформы, экспорт CSV/XLSX | **R1** | Необходимо для отчётности аптеке (часть R1-9) и для kill-критериев (§7 пивота) |
| B2B-биллинг `cash_courier`-комиссии (инвойсы сети за наличные заказы) | **R1** | R1 — основной способ оплаты COD (R1-8); без биллинга платформа не собирает комиссию с COD-заказов вообще — REQ-MON-6/7 |
| B2B-биллинг White-Label роялти/лицензии | **R3** | Привязан к запуску White-Label (R3-2) — роялти не с чего начислять до реального тенанта сети |
| Служба поддержки: приём обращений (`support_tickets`), SLA первого ответа, эскалация | **R1** (облегчённая версия) | Даже COD-заказы порождают жалобы («не приехал», «повреждена упаковка») — минимальная очередь обращений нужна с первого дня; см. ограничение ниже |
| Полный workflow споров (`order_disputes`): заморозка payout, частичный/полный рефанд, `adjustment`, возврат товара (`order_returns`) | **R3** | Явно **R3-3** пивота: «Споры и возвраты (D-09, D-24)... Требует реального объёма транзакций». Схема/state machine (`10-domain-model.md` §«Dispute»/«Return») существуют с R1 как архитектурная основа (правило пивота §2.2: ретрофит дороже), но UI/эндпоинты РЕЗОЛЮЦИИ спора и возврата — недоступны до R3. В R1 `support_tickets.is_escrow_blocking` физически не может стать `true` (гард на уровне use case, см. **SRS-ADM-052**) |

**SRS-ADM-001** [`04-SCOPE-DECISION` §2.2] Given требование этого документа помечено **[R1]**, When
оно описывает таблицу/enum/state machine, уже физически существующую в `10-domain-model.md`/
`11-database-schema.md` (например, `order_disputes`), Then это НЕ означает, что фича спора доступна
пользователю в R1 — метка релиза в этом документе относится к ДОСТУПНОСТИ ФУНКЦИИ (эндпоинт,
экран, use case), а не к присутствию таблицы в схеме (таблица — часть архитектурного фундамента,
всегда R1, см. таблицу выше).

---

## 1. Контексты и слои

Этот документ детализирует **application/presentation** пять bounded context'ов, уже перечисленных
в `10-domain-model.md` §«Ограниченные контексты»: **onboarding**, **moderation**, **disputes**
(только часть `SupportTicket`/`NotificationsFacade`-интеграция — резолюция `OrderDispute` детально
специфицирована там же и не переоткрывается здесь), **notifications**, **analytics**. Плюс
кросс-контекстный неизменяемый журнал `audit_log` (владелец — `identity`/инфраструктурный сквозной
сервис, пишется из ЛЮБОГО модуля через общий порт `AuditLogPort`, не собственный bounded context).

**SRS-ADM-002** [`02` §1.2] Каждый use case этого документа живёт в `application/use-cases/*.use-
case.ts` СВОЕГО модуля (`onboarding`/`moderation`/`notifications`/`analytics`), обращается к другим
модулям ТОЛЬКО через их публичный фасад (`InventoryFacade`, `CatalogFacade`, `PaymentsFacade`,
`OrdersFacade`) — прямой импорт `domain`/`infrastructure` чужого модуля запрещён (правило уже
установлено `SRS-DOM-001`, здесь не повторяется как отдельная проверка).

**SRS-ADM-003** Presentation этого документа — `apps/api/src/modules/{onboarding,moderation,
notifications,analytics}/presentation/*.controller.ts` (REST) + один общий `apps/admin` (React) как
единственный человеческий UI для `super_admin` и `pharmacy_admin` (Charter §3.2: `apps/admin` — «
super_admin + pharmacy_admin + White-Label конфигуратор»). Разделение видимых разделов —
клиентский роутинг по роли из JWT, НЕ отдельные сборки фронтенда.

---

## 2. Онбординг аптечной сети и аптеки (D-22)

> Инварианты сущностей `PharmacyChain`/`PharmacyAccount`, state machine `chain_onboarding_status`/
> `pharmacy_onboarding_status`, домены ошибок — уже полностью определены в `10-domain-model.md`
> (`SRS-DOM-047..051`, `SRS-DOM-161`) и `11-database-schema.md` (Группа A, Группа I). Ниже —
> ТОЛЬКО application/presentation: use cases, эндпоинты, состав формы, видимость до верификации,
> отзыв верификации, напоминания об истечении лицензии.

### 2.1 Подача заявки

**SRS-ADM-004** **[R1]** [REQ-ONBOARD-3/4] `POST /api/v1/pharmacy-chains` (публичный, без JWT —
раздел «Для аптек/поставщиков», REQ-MARKET-7) создаёт `PharmacyChain(status='draft')` из тела:
`legalEntityName, tinInn, legalAddress, directorFullName, contactPhone` (OTP-верификация телефона —
отдельный шаг, `POST /api/v1/pharmacy-chains/:id/verify-contact-phone` через тот же `OtpCode` VO,
`purpose='login'` переиспользуется как `purpose='onboarding_contact'` — **[ДОПОЛНЕНИЕ]**, см. §10.1),
опционально `bankAccountRef`, `payoutMerchantRef`, `isWhitelabelRequested` (при `true` —
`legalAddress`/`registrationCertificateUrl` становятся обязательными полями валидации Zod, не только
БД). Ответ — `201` с `id` и `status='draft'`; use case: `SubmitChainApplicationUseCase`.

**SRS-ADM-005** **[R1]** [REQ-ONBOARD-1/2] `POST /api/v1/pharmacy-accounts` создаёт
`PharmacyAccount(status='draft')` внутри указанного `chainId`. Given `chainId` не передан (соло-
аптека без сети), When use case `SubmitPharmacyApplicationUseCase` выполняется, Then он СНАЧАЛА
прозрачно вызывает `SubmitChainApplicationUseCase` с данными, извлечёнными из полей формы аптеки
(`legalEntityName` = `pharmacyName`, если явно не указано иное), создавая `PharmacyChain` с ОДНОЙ
дочерней точкой — заявителю показывается ОДНА форма, разделение на два агрегата невидимо
пользователю (REQ-ONBOARD-2, единый UX-пайплайн).

**SRS-ADM-006** **[R1]** [REQ-ONBOARD-4] Тело `POST /api/v1/pharmacy-accounts`: `chainId?, name,
addressText, landmarkTj, latitude, longitude, phone, isOpen247, openingTime?, closingTime?,
licenseNumber, licenseIssuingAuthority, licenseIssueDate, licenseExpiryDate, licenseScanUrl,
pharmacistInChargeName`. Файлы (`licenseScanUrl`, `registrationCertificateUrl`) загружаются
ОТДЕЛЬНО через `POST /api/v1/onboarding-documents` (`multipart/form-data`, `ObjectStorageProvider` →
MinIO/`prescriptions`-подобный bucket `onboarding-docs`, `Content-Type` ограничен `image/*,
application/pdf`, ≤10 МБ) — эндпоинт возвращает `{ url }`, который клиент подставляет в поле формы
ДО финальной отправки (тот же паттерн, что `prescription_image_url`, Charter §3.6.3: без
web-специфичных механизмов, `multipart/form-data` работает и из Flutter в R2).

**SRS-ADM-007** **[R1]** [REQ-ONBOARD-19] Given повторная заявка с `tinInn`, уже существующим в
`pharmacy_chains` со `status='rejected'`, When `SubmitChainApplicationUseCase.execute()`, Then
существующая запись переводится `rejected → draft` (обновление полей заявки, `submitted_at=NULL`)
— НЕ создаётся вторая строка (иначе `UNIQUE(tin_inn)` конфликт, `409 CONFLICT`). Given `tinInn`
существует в ЛЮБОМ ДРУГОМ статусе (`pending_review`, `active`, ...), Then `409 CONFLICT`
`{ code: 'CHAIN_APPLICATION_ALREADY_EXISTS' }` — **[ДОПОЛНЕНИЕ кода ошибки]**, см. §10.2.

**SRS-ADM-008** **[R1]** `POST /api/v1/pharmacy-chains/:id/submit` и
`POST /api/v1/pharmacy-accounts/:id/submit` переводят `draft → pending_review`, устанавливают
`submitted_at = now()`, `pharmacy_verification.sla_target_at = now() + 2 рабочих дня` (REQ-ONBOARD-
18, ориентир, не жёсткий дедлайн — не блокирует, только видно в UI очереди оператора как
просроченное/непросроченное). Разделение `draft` (черновик, можно правити многократно) и
`pending_review` (подано, ожидает решения) — намеренное: черновик не создаёт нагрузку на очередь
оператора при незавершённом заполнении формы.

### 2.2 Верификация оператором

**SRS-ADM-009** **[R1]** [REQ-ONBOARD-5/6] `GET /api/v1/pharmacy-chains?status=pending_review` и
`GET /api/v1/pharmacy-accounts?status=pending_review` (только `super_admin`, `pharmacy-
accounts:approve` §12 РБАК-матрицы `12-api-conventions...md`) — очередь верификации, курсорная
пагинация (`SRS-API-004`), сортировка по умолчанию `submittedAt:asc` (FIFO, SLA-справедливость).
Карточка заявки в `apps/admin` показывает все поля формы + превью документов (`licenseScanUrl`,
`registrationCertificateUrl`) рядом с чек-листом (REQ-ONBOARD-6: ручная визуальная сверка —
интерфейс НЕ предполагает автоматическую верификацию по внешнему реестру, только фиксацию решения
человека).

**SRS-ADM-010** **[R1]** `POST /api/v1/pharmacy-chains/:id/approve` /
`POST /api/v1/pharmacy-accounts/:id/approve` — тело `{ checklist: Record<string, boolean>, notes?
}`. Use case `ReviewChainApplicationUseCase`/`ReviewPharmacyApplicationUseCase` атомарно (одна
транзакция): (1) переводит `status → approved` (домен, `SRS-DOM-invariants` уже проверяет граф
переходов); (2) пишет строку в `onboarding_review_log(action='approve', actor_user_id, reason=notes,
checklist_snapshot=checklist)` (REQ-ONBOARD-7); (3) публикует `PharmacyChainActivatedEvent`/аналог
для отложенного авто-перехода `approved → active` (`SRS-DOM-invariant` REQ-ONBOARD-9: при появлении
ПЕРВОЙ дочерней `pharmacies.status='active'`).

**SRS-ADM-011** **[R1]** [REQ-ONBOARD-8] Ровно ТРИ дополнительных решения оператора, каждое —
отдельный эндпоинт (не общий `PATCH status`, чтобы каждое несло собственную обязательную
`reason`-валидацию Zod): `POST /:id/request-changes { reason: string }` (`pending_review →
changes_requested`, сброс `submitted_at` НЕ происходит — время в `changes_requested` не засчитывается
в SLA, REQ-ONBOARD-18, вычисляется как `resolved_at - submitted_at - Σ(время в changes_requested)`);
`POST /:id/reject { reason: string }` (`pending_review → rejected`, терминально до повторной
подачи §2.1); `POST /:id/terminate { reason: string }` (`* → terminated`, терминально НАВСЕГДА —
единственный переход без пути назад, применяется при доказанном мошенничестве/утрате лицензии
безвозвратно, не путать с `suspend`).

**SRS-ADM-012** **[R1]** [REQ-ONBOARD-20, `SRS-DOM-049`] Given `pharmacy_admin` вызывает
`PATCH /api/v1/pharmacy-accounts/:id { addressText, latitude, longitude }` для аптеки со
`status='active'`, When домен переводит её в `pending_review` (уже специфицировано `SRS-DOM-049`),
Then `apps/admin`-очередь верификации получает НОВУЮ карточку с флагом `reviewReason=
'address_change'` (отличается от первичной заявки визуально — оператору не нужно проверять лицензию
заново с нуля, только соответствие адреса лицензии) — **[ДОПОЛНЕНИЕ]**: поле `pharmacy_verification.
review_reason VARCHAR(30)` (`'initial'|'address_change'|'reactivation'`), см. §10.1.

### 2.3 Что доступно ДО верификации

**SRS-ADM-013** **[R1]** [REQ-ONBOARD-11/12, `SRS-CAT-010`] Точное условие видимости аптеки в поиске
уже установлено `20-module-catalog-search.md` (`SRS-CAT-010`) и здесь НЕ переопределяется — только
дословно зеркалируется, чтобы формулировки двух модулей не расходились: Given `pharmacies.status ≠
'active'` (условие аптеки — РОВНО статус `'active'`, `'approved'` сюда НЕ входит) ИЛИ
`pharmacy_chains.status ∉ {'approved','active'}` (ОТДЕЛЬНОЕ условие родительской сети — у неё
допустимых статусов ДВА, `'approved'` и `'active'`; путать этот набор с условием аптеки нельзя — это
два разных условия с разным числом допустимых статусов, а не одна формулировка на двоих), When любой
публичный поиск/каталог (`CatalogFacade.search()`), Then эта аптека исключается из выдачи ПОЛНОСТЬЮ
(`SRS-DOM-invariant`, уже установлено REQ-ONBOARD-11) — `draft`/`pending_review`/
`changes_requested`/`rejected`/`approved`/`suspended`/`terminated` НИКОГДА не видны в customer-facing
поиске (видна ТОЛЬКО `pharmacies.status = 'active'`), вне зависимости от того, есть ли у них уже
загруженные остатки. Следствие: аптека в статусе `approved` (сеть уже `active`, сама точка одобрена,
но ещё не переведена в `active`, REQ-ONBOARD-9) НЕ появляется в поиске — это устраняет прежнее
расхождение с `SRS-ADM-015` ниже, где оформление заказа у такой аптеки и так невозможно (`422
PHARMACY_SUSPENDED`): теперь «не видно в поиске» и «нельзя заказать» совпадают для `approved`,
разработчик реализующий фильтр видимости по этому требованию получает тот же SQL-предикат, что и
`PostgresSearchProvider` из `SRS-CAT-010`, без противоречия между модулями 20 и 27.

**SRS-ADM-014** **[R1]** [D-12, REQ-SYNC] Given аптека в `draft`/`pending_review`/
`changes_requested` (ещё не одобрена), When `pharmacy_admin` этой заявки вызывает `POST /api/v1/
inventory/batch-update` или ручной ввод остатков в своём кабинете, Then приём ДАННЫХ РАЗРЕШЁН
(`IngestInventoryBatchUseCase` не проверяет `onboarding_status`, только `tenant`/`pharmacy_id`
существование) — цель: к моменту `approve` каталог аптеки уже наполнен и она сразу видна в поиске,
не требуя повторного ввода после одобрения. Единственное ограничение — `inventory:ingest`
(§4.1 `12-api-conventions...md`) доступно только заявителю САМОЙ этой заявки (`actor.pharmacyId
=== target.id` даже для `draft`-статуса, guard не завязан на onboarding-статус).

**SRS-ADM-015** **[R1]** [REQ-ONBOARD-12] Given `PharmacyAccount.status ∉ {'active'}` (включая
`approved`, если родительская сеть ещё не `active` — REQ-ONBOARD-10/9), When `POST /api/v1/orders`
(checkout) ссылается на этот `pharmacyId`, Then `422 PHARMACY_SUSPENDED` — код ошибки переиспользуется
для ВСЕХ невозможных для заказа статусов (`draft`/`pending_review`/`suspended`/`terminated`), не
заводится отдельный код на каждый статус (уже установлено `10-domain-model.md`
`ParentChainNotActiveError`/`PharmacySuspendedError`, здесь — подтверждение применимости ко ВСЕМ
неактивным статусам, не только `suspended`).

### 2.4 Приостановка, отзыв верификации, истечение лицензии

**SRS-ADM-016** **[R1]** [REQ-ONBOARD-13/14, `SRS-DOM-161`] `POST /api/v1/pharmacy-accounts/:id/
suspend { reason: pharmacy_suspension_reason, notes? }` — только `super_admin`. Use case
`SuspendPharmacyUseCase` вызывает `pharmacyAccount.suspend(reason, actor)` (домен уже решает судьбу
`pending_payment`-заказов, `SRS-DOM-161`). Given `reason ∈ {'fraud_or_safety','license_revoked'}`,
Then ответ включает `requiresForceCancelAction: true` — `apps/admin` показывает отдельную кнопку
«Принудительно отменить незавершённые заказы», которая вызывает ОТДЕЛЬНЫЙ эндпоинт
`POST /api/v1/pharmacy-accounts/:id/force-cancel-incomplete-orders { reason }` (`ForceCancel
IncompleteOrdersUseCase`, `Idempotency-Key` обязателен — повторный вызов не должен рефандить дважды).

**SRS-ADM-017** **[R1]** [«Отзыв верификации» из задания, расширяет `SRS-DOM-050`]
`POST /api/v1/pharmacy-verifications/:id/revoke { reason: string }` (только `super_admin`) — это
ОТДЕЛЬНОЕ действие от `suspend`: отзыв верификации означает, что предыдущее решение `approve`
признано ошибочным (например, лицензия впоследствии оказалась поддельной, обнаружено после
активации). Use case `RevokeVerificationUseCase`: (1) `pharmacy_verification.verification_status →
'revoked'` (**[ДОПОЛНЕНИЕ]** новое значение enum `verification_status`, см. §10.1); (2) КАСКАДНО
вызывает `pharmacyAccount.suspend(reason='license_revoked', actor)` для ВСЕХ активных точек этого
субъекта проверки (если отзыв на уровне сети — все дочерние аптеки; если на уровне отдельной аптеки
— только она); (3) запись в `onboarding_review_log(action='revoke_verification')`. Отличие от
обычного `reject` (который применим только к ещё НЕ одобренной заявке) — `revoke` применим ТОЛЬКО
к уже `verified`/`active` субъекту (`409 CONFLICT` при попытке revoke `not_started`/`pending_review`).

**SRS-ADM-018** **[R1]** [REQ-ONBOARD-16, `SRS-DOM-050`] Ежедневная BullMQ repeatable-джоба
`LicenseExpiryCheckJob` (`apps/worker`, cron `0 6 * * *` Asia/Dushanbe) сканирует
`pharmacies.license_expiry_date`: `daysRemaining ∈ {30, 14, 3}` → публикует `LicenseExpiringSoonEvent`
РОВНО ОДИН РАЗ на пару `(pharmacyId, daysRemaining)` (идемпотентность уже установлена
`10-domain-model.md` таблицей событий); `daysRemaining <= 0` (лицензия истекла) → системный
(служебный `user_id` джобы) вызов `pharmacyAccount.suspend(reason='license_expired', actor=SYSTEM)`
БЕЗ участия человека (`LicenseExpiredAutoSuspendEvent`, `SRS-DOM-050`). `apps/admin` содержит экран
«Истекающие лицензии» (`GET /api/v1/pharmacy-accounts?filter[licenseExpiryDate][lte]=<+30d>`,
отсортировано по `licenseExpiryDate:asc`) для проактивного контроля оператором ДО авто-приостановки.

**SRS-ADM-019** **[R1]** [REQ-ONBOARD-17] `POST /api/v1/pharmacy-accounts/:id/request-reactivation`
(доступно `pharmacy_admin` этой аптеки, ЛЮБАЯ причина `suspended`) переводит `suspended →
pending_review` с `review_reason='reactivation'` (§2.2) — попадает в ту же очередь оператора, чек-
лист заново, `approve` из этой заявки переводит `pending_review → approved → active` (тот же путь,
что первичная заявка). Программный обход этого пути запрещён на уровне домена
(`AutomaticReactivationForbiddenError`, уже `SRS-DOM-050`) — здесь подтверждается: НЕТ эндпоинта
`suspended → active` напрямую, ни для одной роли, включая `super_admin`.

---

## 3. Модерация каталога

> `CatalogMatchQueueItem`, таблица `catalog_match_queue`, композитный матчинг (D-06) уже
> специфицированы `10-domain-model.md`/`11-database-schema.md` (Группа A/B). Ниже — интерфейс
> оператора (модуль `moderation`), массовые операции, создание нового медикамента, слияние дублей.

**SRS-ADM-020** **[R1]** [D-06] `GET /api/v1/catalog-match-queue?status=pending_review&filter
[pharmacyId]=...&sort=fuzzySimilarityScore:desc` — очередь модерации. Карточка строки показывает
исходные поля выгрузки (`rawTradeName`, `rawDosageForm`, `rawDosageStrength`,
`rawManufacturerName`, `rawBarcode`) РЯДОМ с лучшим fuzzy-кандидатом (`fuzzyCandidateMedicineId`,
`fuzzySimilarityScore`) — оператор видит предложение системы, но принимает решение сам (это НЕ
авто-подстановка выше порога, в отличие от OCR-confidence D-14: composite-матчинг каталога НЕ имеет
автоматического приёма, порог `pg_trgm` только направляет очередь на ручную курацию, R1-5).

**SRS-ADM-021** **[R1]** `POST /api/v1/catalog-match-queue/:id/resolve` — тело
`{ action: 'match_existing' | 'create_new' | 'reject', medicineId?, newMedicineDraft?, reason? }`.
Use case `ResolveCatalogMatchQueueItemUseCase`:
- `match_existing` (требует `medicineId`) → создаёт/обновляет запись сопоставления
  `pharmacy_sku_mapping(pharmacy_id, internal_sku, medicine_id)` (уже подразумевается схемой Группы
  B, инвентарь ссылается на `medicine_id` через этот мост), `catalog_match_queue.status='matched'`,
  `resolved_medicine_id=medicineId`.
- `create_new` (требует `newMedicineDraft`, валидируемый той же Zod-схемой, что и
  `POST /api/v1/medicines`, §3.2) → атомарно создаёт `Medicine` (по умолчанию `is_published=false`,
  `SRS-DOM-013` — публикация требует `substances.length>0`, отдельный шаг §3.2), затем сопоставляет
  как `match_existing`. `catalog_match_queue.status='created_new'`.
- `reject` (требует `reason`) → `status='rejected'`, строка НЕ участвует в поиске повторно (аптека
  видит в истории синхронизации причину отказа, REQ-SYNC-10).

**SRS-ADM-022** **[R1]** [Массовые операции] `POST /api/v1/catalog-match-queue/bulk-resolve
{ ids: UUID[], action: 'match_existing', medicineId }` (максимум 100 `id` за вызов, `413
PAYLOAD_TOO_LARGE` при превышении) — применяется, когда десятки аптек независимо прислали одну и ту
же несопоставленную позицию (частый паттерн: новый импортный препарат без внутреннего справочника
ни у одной сети). `create_new`/`reject` НЕ доступны в bulk-режиме (эти действия требуют
индивидуального решения по каждой строке — создание медикамента без проверки конкретных данных
партии есть риск дублирования каталога).

### 3.2 Создание нового медикамента, слияние дублей, назначение категории

**SRS-ADM-023** **[R1]** [D-07] `POST /api/v1/medicines` (`super_admin`, а также вызывается
внутренне из §3.1 `create_new`) — тело: все поля `medicines` (§«Группа A» `11-database-schema.md`)
+ ОБЯЗАТЕЛЬНЫЙ массив `substances: [{ substanceId, strengthValue, strengthUnit }]` (Zod
`.min(1)` — `Medicine` без веществ создать НЕЛЬЗЯ даже как `super_admin`, `SRS-DOM-013` не имеет
исключений для админского пути). `substanceId`, отсутствующий в справочнике `substances`, создаётся
через отдельный вложенный `POST /api/v1/substances { innName, innNameEn? }` ДО привязки (не
неявное автосоздание внутри `POST /medicines` — предотвращает опечатки-дубли в справочнике веществ).

**SRS-ADM-024** **[R1]** [D-08] `PATCH /api/v1/medicines/:id/control-category
{ controlCategory, reason }` — `reason` ОБЯЗАТЕЛЕН (Zod, не только БД-уровень), каждый вызов
пишет `audit_log(category='control_category_change', entity_type='medicine', entity_id=:id,
metadata={ from, to })` (REQ-REG аудит контролируемых веществ — юридическая чувствительность
требует полной прослеживаемости, кто и когда разрешил дистанционную продажу конкретной позиции).
Домен уже проверяет согласованность (`chk_medicines_control_category_requires_rx`,
`SRS-DOM-invariant`): попытка установить `potent`/`psychotropic`/`narcotic` без одновременного
`isPrescriptionRequired=true` → `400 VALIDATION_ERROR`.

**SRS-ADM-025** **[R1]** [Слияние дублей] `POST /api/v1/medicines/:id/merge-into/:targetId`
(`super_admin`) — use case `MergeDuplicateMedicinesUseCase`. Given два `Medicine` описывают
фактически один и тот же препарат (разные операторы независимо создали дубли из разных
`catalog_match_queue`), When вызывается merge, Then атомарно: (1) все `pharmacy_sku_mapping`,
ссылающиеся на `:id`, перепривязываются на `:targetId`; (2) `medicines.id = :id` НЕ удаляется
физически (исторические `order_items.medicine_id` продолжают ссылаться на него — юридическая
неизменяемость истории заказа) — вместо этого помечается `is_published=false` и записывается строка
в `medicine_merge_log(source_medicine_id=:id, target_medicine_id=:targetId, merged_by, reason)`
(**[ДОПОЛНЕНИЕ]**, §10.1); (3) поиск/каталог после мержа отдаёт `:targetId` при обращении к `:id`
через `GET /api/v1/medicines/:id` (`302`-подобный редирект В ТЕЛЕ ответа `{ data: { mergedInto:
targetId } }` со статусом `200`, не HTTP-редирект — REST-клиенты `packages/contracts` не всегда
следуют редиректам автоматически).

**SRS-ADM-026** **[R1]** Given `medicine_id` уже был целью или источником слияния РАНЕЕ (`medicine_
merge_log` содержит строку), When повторный `merge-into` запрашивается для той же пары, Then
`409 CONFLICT` `{ code: 'MEDICINE_ALREADY_MERGED' }` — предотвращает случайное создание цепочки
слияний A→B→A (циклическую ссылку).

---

## 4. Админ-панель `super_admin`

### 4.1 Тенанты

**SRS-ADM-027** **[R1]** `GET /api/v1/tenants` / `GET /api/v1/tenants/:id` — список/деталь. `POST
/api/v1/tenants` создаёт тенант ТОЛЬКО как побочный эффект одобрения `pharmacy_chains.is_whitelabel_
requested=true` (не отдельная форма — тенант без сети-владельца бессмысленен, кроме единственной
`neutral`, которая создаётся сид-скриптом при `pnpm db:seed`, не через API). `PATCH /api/v1/
tenant-settings/:tenantId` — программное изменение `brand_name/brand_logo_url/brand_palette/
cod_limit_diram/hold_period_days/...` (все поля §«Группа C» `tenant_settings`) — **без визуального
редактора** в R1 (JSON/форма с текстовыми полями и HEX-инпутами для палитры, не drag&drop) —
полноценный конфигуратор (превью в реальном времени, мастер поддомена) — R3 (R3-2).

**SRS-ADM-028** **[R1]** [Фиче-флаги] `GET/POST/PATCH /api/v1/feature-flags` (**[ДОПОЛНЕНИЕ]**
таблица `feature_flags`, §10.1) — `super_admin` включает/выключает функциональность без деплоя.
Обязательный флаг R1: `prescription_ocr_pipeline_enabled` (гейтит R2-4 согласно тексту пивота
«включается фиче-флагом» — порт `PrescriptionOcrProvider` и `MockOcrProvider` существуют с R1,
реальный `GeminiOcrProvider` физически подключается в R2, но переключатель в схеме БД и админке
готов заранее, чтобы включение не требовало миграции). Флаг может быть глобальным
(`scope='global'`) или per-tenant (`scope='tenant', tenantId=...`) — per-tenant запись
переопределяет глобальную (та же логика специфичности, что `platform_fee`, `SRS-DOM-160`, но без
дат действия — фиче-флаг либо включён, либо нет, без «расписания»).

### 4.2 Аптеки, пользователи

**SRS-ADM-029** **[R1]** `GET /api/v1/pharmacy-accounts` (кросс-тенантный обзор для `super_admin` —
единственная роль, для которой `orders:read:any`-подобный охват распространяется и на аптеки,
`filter[status]`, `filter[chainId]`, полнотекстовый `filter[name][like]`) — единая точка входа для
поддержки/расследований, дублирует функционал очереди §2, но без ограничения `status=pending_
review` (видны ВСЕ статусы, включая `active`/`suspended`/`terminated`).

**SRS-ADM-030** **[R1]** `GET /api/v1/users` (`super_admin` только, `filter[role]`, `filter
[phoneNumber][like]`, `filter[tenantId]`) — поиск пользователей по всем тенантам.
`PATCH /api/v1/users/:id { isActive: false }` — деактивация (не физическое удаление — `deleted_at`
зарезервирован для явного запроса на удаление ПДн, отдельная процедура, не описывается здесь).
`PATCH /api/v1/users/:id/role` — смена роли ТОЛЬКО между `pharmacist`/`courier`/`pharmacy_admin` в
рамках одной точки/сети (смена на `super_admin`/`support_agent` — отдельный эндпоинт `POST /api/v1/
users/:id/grant-platform-role`, требует явного `reason`, пишется в `audit_log`, категория —
**[ДОПОЛНЕНИЕ]** новое значение `audit_action_category` `'role_grant'`, см. §10.1, — платформенные
роли не должны выдаваться тем же путём, что бытовая смена роли сотрудника аптеки).

### 4.3 Заказы: поиск, деталь, ручное вмешательство

**SRS-ADM-031** **[R1]** `GET /api/v1/orders` для `super_admin` реализует `orders:read:any` (уже
установлено `12-api-conventions...md` §4.1) — полнотекстовый поиск по `orderNumber`, фильтр по
`status`, `tenantId`, `pharmacyId`, `customerId`, диапазону `createdAt`. Карточка деталей заказа
показывает ПОЛНУЮ временную шкалу (`processing_started_at → picked_up_at → delivered_at`),
связанный `payout_schedule`, связанные `escrow_ledger`-записи (если `payment_method != 'cash_
courier'`, REQ-PAY-14), связанный `prescription_id` (только метаданные статуса для `super_admin` по
умолчанию — доступ к самому изображению рецепта требует ОТДЕЛЬНОГО клика с явной причиной,
`SRS-DOM-155в`, дальше §7).

**SRS-ADM-032** **[R1]** [REQ-PAY-1] `POST /api/v1/orders/:id/payment-override
{ targetStatus, reason }` (только `super_admin`) — use case `AdminPaymentOverrideUseCase`. Это
ЕДИНСТВЕННЫЙ путь вручную изменить `orders.status` в обход банковского вебхука (уже установлено
REQ-PAY-1: «paid_escrow — исключительно через подписанный вебхук; ручное изменение — только
`admin_payment_override`»). Каждый вызов ОБЯЗАН: (1) `reason` непустой (Zod `.min(10)` —
содержательное объяснение, не «test»); (2) пишет `audit_log(category='payment_override', entity_
type='order', entity_id=:id, reason, actor_user_id, metadata={ statusFrom, statusTo, orderTotal
Diram })`; (3) НЕ обходит доменную state machine заказа (`Order.markPaidEscrowManually(reason,
actor)` — отдельный доменный метод-намерение, не сырой сеттер, всё ещё проверяет допустимость
перехода из ТЕКУЩЕГО статуса).

**SRS-ADM-033** **[R1]** [`SRS-DOM-171`] `POST /api/v1/orders/:id/admin-force-cancel { reason }`
(`super_admin`) — обёртка над `AdminForceCancelOrderUseCase` (уже упомянут `10-domain-model.md`
`SRS-DOM-171`), доступна для ЛЮБОГО нетерминального статуса заказа (не только приостановленной
аптеки §2.4) — универсальный инструмент ручного вмешательства поддержки при инциденте (например,
подделка рецепта, обнаруженная постфактум) с обязательным полным `PaymentProvider.refund()`, если
заказ был оплачен, и `audit_log(category='force_cancel_order')`.

### 4.4 Финансы

**SRS-ADM-034** **[R1]** [D-02/D-03] `GET /api/v1/finance/escrow-ledger?filter[orderId]=...` —
просмотр (READ-ONLY, никогда не `POST`/`PATCH` на саму таблицу — append-only гарантия `SRS-DB`
уже установлена) записей `escrow_ledger` для расследований и сверки. `GET /api/v1/finance/payout-
schedule?filter[status]=due&filter[pharmacyId]=...` — очередь предстоящих выплат аптекам.
`GET /api/v1/finance/reconciliation-alerts` — список заказов, где `EscrowReconciliationJob`
(REQ-PAY-9, уже упомянута `10-domain-model.md` через `LedgerImbalanceError`) обнаружила
рассинхронизацию (`hold_created != Σ(остальные записи)`) — единственный экран, требующий
немедленного ручного расследования `super_admin`, поскольку автоматическое исправление денежного
расхождения запрещено архитектурой.

**SRS-ADM-035** **[R1]** [D-03/REQ-MON-8] `GET/POST/PATCH /api/v1/finance/commission-rates`
(`platform_fee` таблица) — управление ставками с учётом специфичности
(`tenantId/chainId/category`) и `effectiveFrom/effectiveTo`. Изменение ставки НЕ ретроактивно
(`SRS-DOM-160`/`SRS-DOM-008` уже гарантируют снэпшот в `order_items` — этот экран лишь редактирует
будущие ставки, UI явно предупреждает: «Изменение не повлияет на уже оформленные заказы»).

**SRS-ADM-036** **[R1]** [REQ-MON-6/7, `platform_billing_invoices`] `GET /api/v1/finance/billing-
invoices?filter[chainId]=...&filter[type]=cash_courier_commission` — просмотр инвойсов
`cash_courier`-комиссии, начисляемых сети за наличные заказы (R1 — основной способ оплаты).
`POST /api/v1/finance/billing-invoices/:id/mark-paid` (ручная фиксация оплаты по банковской
выписке — в R1 нет автоматического сверщика поступлений от сети, это ручной процесс бухгалтера
платформы, use case `MarkInvoicePaidUseCase`, пишет `audit_log`). Просрочка `due_at + grace_period`
→ автоматическая `pharmacy_chains.is_active=false` (REQ-MON-7, джоба `InvoiceOverdueCheckJob`) —
снятие блокировки ТОЛЬКО через `POST /api/v1/finance/billing-invoices/:id/lift-block { reason }`
(`super_admin`, обязательный `reason`, аудит).

### 4.5 Настройки платформы

**SRS-ADM-037** **[R1]** `GET/PATCH /api/v1/platform-settings` — глобальные (не per-tenant)
константы: `RATE_LIMIT_*`, `PAYMENT_PROVIDER_TIMEOUT_MS`, `WS_HEARTBEAT_INTERVAL_MS` и т.п.
(`ASSUMPTION`-значения из `12-api-conventions...md`) — эти значения ЛИБО ENV на уровне процесса
(требуют рестарта), ЛИБО (для тех, что явно помечены «per-tenant конфигурируемо» — SLA, лимиты
COD) редактируются per-tenant через `tenant_settings` (§4.1), НЕ дублируются здесь. Экран
`platform-settings` показывает ТОЛЬКО те, что физически являются process-level ENV (документирует
текущее значение read-only + инструкцию «требует передеплоя»), чтобы не создавать иллюзию
изменяемости того, что на самом деле требует релиза.

### 4.6 Ограничение R1 vs R3 в White-Label конфигураторе

**SRS-ADM-038** **[R3]** Полный визуальный конфигуратор брендинга (`apps/admin` раздел «White-
Label»): drag-and-drop загрузка лого с обрезкой, live-превью палитры на макете витрины, мастер
подключения кастомного домена (DNS-инструкция + автоматическая проверка `CNAME`), self-service
редактирование сетью БЕЗ участия `super_admin` (сейчас, в R1, `PATCH /tenant-settings` доступен и
`pharmacy_admin` тенанта, если `is_whitelabel_active=true` — уже установлено `12-api-conventions...
md` §4.1 permission `tenancy:manage-branding` — но БЕЗ визуального интерфейса, только сырая форма)
— полноценный конфигуратор блокирован до подписанного LOI/оплаченного пилота сети (R3-2 пивота),
не техническими причинами.

---

## 5. Кабинет `pharmacy_admin`

> Ассортимент/остатки (детальный UX сборки заказа, сканирование, SLA-таймер) — предмет отдельного
> модуля «Orders/Fulfillment» (вне этого документа) — здесь только АДМИНИСТРАТИВНЫЙ срез: обзорные
> списки, сотрудники, ключи 1С, отчёты, расписание.

### 5.1 Свои аптеки, остатки и цены (обзор)

**SRS-ADM-039** **[R1]** `GET /api/v1/pharmacy-accounts?scope=own` (резолвится из
`actor.chainId`, не принимает произвольный `chainId` в query для этой роли — иначе `pharmacy_admin`
одной сети мог бы читать список точек чужой) — список СВОИХ точек с текущим `status`,
`isActive`, `licenseExpiryDate` (с визуальным предупреждением при `<30 дней`, синхронизировано
с §2.4 джобой). `GET /api/v1/pharmacy-accounts/:id/inventory-summary` — агрегированная сводка
(количество SKU, доля просроченных остатков по SLA `last_synced_at`, топ-10 позиций по обороту) —
READ-ONLY витрина поверх `InventoryFacade`, не дублирует детальный экран ввода остатков (тот —
часть модуля Catalog/Inventory).

### 5.2 Свои заказы (обзор)

**SRS-ADM-040** **[R1]** `GET /api/v1/orders?scope=own` (резолвится по `pharmacy_id ∈ actor.own
PharmacyIds`, реализует `orders:read:pharmacy` §4.1 `12-api-conventions...md`) — список заказов
своей сети с фильтром по статусу/SLA-просрочке (`filter[slaBreached]=true` — вычисляемое поле
`now() > sla_deadline_at AND status='processing'`). Это ОБЗОРНЫЙ список для `pharmacy_admin`
(мониторинг сети); интерактивная сборка конкретного заказа (сканирование, кнопка «Передано
курьеру») — экран роли `pharmacist`, специфицирован в модуле Orders/Fulfillment, не здесь.

### 5.3 Сотрудники и роли

**SRS-ADM-041** **[R1]** [Charter §3.7, `SRS-API-035`] `POST /api/v1/staff-accounts
{ phoneNumber, fullName, role: 'pharmacist'|'courier', pharmacyId? }` (`pharmacy_admin`, уже
установлено RBAC §4.1). Guard: `role='pharmacist'` требует `pharmacyId ∈ actor.ownPharmacyIds`;
`role='courier'` создаёт `Courier(chainId=actor.chainId)` (собственный флот, REQ-COUR-1) —
`pharmacy_admin` НЕ может создать курьера платформенного пула (`chainId=NULL`, только `super_
admin`, уже установлено §4.1 матрицы прав). Ответ включает `temporaryOtpHint: false` — учётная
запись создаётся БЕЗ пароля, первый вход сотрудника — обычный OTP-логин на указанный номер
(`SRS-API` §3.1), `pharmacy_admin` не видит и не задаёт никакой пароль (Charter §5: OTP —
единственный способ входа для человеческих ролей).

**SRS-ADM-042** **[R1]** `GET /api/v1/staff-accounts?scope=own` / `PATCH /api/v1/staff-accounts/:id
{ isActive: false }` (деактивация сотрудника при увольнении — НЕ роняет исторические `order_
items`/`delivery_assignments`, где он фигурирует как актор, `ON DELETE SET NULL`/`RESTRICT`
согласно уже определённым внешним ключам §«Группа C/H» `11-database-schema.md`).

### 5.4 API-ключи 1С

**SRS-ADM-043** **[R1]** [D-11] `POST /api/v1/pharmacy-accounts/:id/api-keys` (`pharmacy_admin`
своей точки, `super_admin` любой) — генерирует пару `(apiKey, hmacSecret)` СЛУЧАЙНО
(`crypto.randomBytes(32)`, не производные от предсказуемых данных), сохраняет ТОЛЬКО
`argon2`-хеши обоих (`pharmacy_api_keys.key_hash`, `.hmac_secret_hash`), возвращает В ОТВЕТЕ (и
ТОЛЬКО в этом единственном ответе) `{ apiKey, hmacSecret, keyPrefix }` — **SRS-ADM-044** ниже
формализует правило «показ один раз».

**SRS-ADM-044** **[R1]** [Безопасность, `02` §5] Given `POST /api/v1/pharmacy-accounts/:id/api-keys`
успешно завершился, When клиент делает ЛЮБОЙ последующий запрос (включая `GET .../api-keys`), Then
полное значение `apiKey`/`hmacSecret` НИКОГДА больше не возвращается ни в одном ответе API, ни в
одном логе (`pino`-редактор полей маскирует `apiKey`/`hmacSecret` по имени поля на уровне
сериализатора логгера, не полагаясь на то, что разработчик не забудет залогировать) —
`GET /api/v1/pharmacy-accounts/:id/api-keys` возвращает ТОЛЬКО `{ id, keyPrefix, isActive,
requireMtls, createdAt, lastUsedAt, revokedAt }` (`key_prefix` — не секрет, безопасно для
идентификации в UI: «ключ sec_live_9f83a2c8, использован 2 часа назад»).

**SRS-ADM-045** **[R1]** [D-11] `POST /api/v1/pharmacy-accounts/:id/api-keys/:keyId/rotate`
(`Idempotency-Key` обязателен, `12-api-conventions...md` §1.4) — use case `RotatePharmacyApiKey
UseCase`: создаёт НОВЫЙ ключ (`rotated_from=:keyId`), помечает старый `is_active=false` НЕ
немедленно, а с задержкой `API_KEY_ROTATION_GRACE_PERIOD_HOURS` (ASSUMPTION 24) — оба ключа
валидны параллельно в течение окна (1С-модуль клиента может быть перенастроен не мгновенно) —
фоновая джоба `RevokeExpiredRotatedKeysJob` физически деактивирует старый ключ по истечении окна.
Новый секрет показывается ОДИН РАЗ по правилу `SRS-ADM-044`.

**SRS-ADM-046** **[R1]** `POST /api/v1/pharmacy-accounts/:id/api-keys/:keyId/revoke { reason }` —
немедленная деактивация (без grace period, в отличие от ротации — отзыв, в отличие от плановой
замены, предполагает подозрение компрометации). `PATCH /api/v1/pharmacy-accounts/:id/api-keys/
:keyId { requireMtls: true }` — включение обязательного mTLS для конкретного ключа (D-11, крупные
сети).

### 5.5 Отчёты и выплаты

**SRS-ADM-047** **[R1]** `GET /api/v1/pharmacy-accounts/:id/reports/sales?period=2026-08&format=
json|csv` — агрегированные продажи (GMV, количество заказов, средний чек, топ-10 медикаментов по
выручке) за период. `GET /api/v1/pharmacy-accounts/:id/payouts?filter[status][in]=due,paid` —
история/расписание выплат (`payout_schedule`, READ-ONLY для `pharmacy_admin` — управление статусом
только через доменные переходы, не ручной `PATCH`). `format=csv` — синхронный ответ для периодов
≤31 дня; более длинные периоды — асинхронный экспорт (см. §8.3).

**SRS-ADM-048** **[R1]** [REQ-SYNC-10] `GET /api/v1/pharmacy-accounts/:id/inventory-sync-history`
— история `inventory_sync_batches` (канал, `syncType`, `acceptedRows/rejectedRows`,
`completedAt`) с возможностью раскрыть `inventory_sync_errors` конкретного батча (уже установлено
REQ-SYNC-10: «доступно в `apps/admin`, не только как HTTP-ответ»). Для канала `commerce_ml` — в R1
этот экран показывает батчи, поступившие ЛЮБЫМ каналом ОДИНАКОВО (единый `IngestInventoryBatch
UseCase`, D-12); специфичный для CommerceML мониторинг ошибок XML-парсинга — расширение экрана в
R2 (R2-3), не новый экран.

### 5.6 Расписание и зоны доставки

**SRS-ADM-049** **[R1]** `PATCH /api/v1/pharmacy-accounts/:id/schedule
{ isOpen247, openingTime?, closingTime? }` — редактирует `pharmacies.is_24_7/opening_time/
closing_time` (Группа A). Изменение немедленно влияет на признак «открыто сейчас» в карте
(CUJ-1, R1-6).

**SRS-ADM-050** **[R1]** [«Зоны доставки» из задания] `PATCH /api/v1/pharmacy-accounts/:id/delivery-
zone { maxDeliveryRadiusKm }` — **[ДОПОЛНЕНИЕ]** новое поле `pharmacies.max_delivery_radius_km`
(§10.1). R1 использует ПРОСТУЮ модель зоны — круговой радиус от `geo_point` (согласуется с уже
принятой формулой `delivery_fee_tjs = базовая ставка + ставка/км × haversine`, REQ-DELIV-1: зона
"дотягиваемости" курьером — тот же радиус, что участвует в расчёте тарифа, не отдельная полигональная
геометрия). `OrdersFacade.isWithinDeliveryZone(pharmacyId, customerGeoPoint)` — guard checkout,
`422 DELIVERY_ZONE_EXCEEDED` (**[ДОПОЛНЕНИЕ кода ошибки]**, §10.2) при превышении. Полигональные
зоны (не круг, а произвольная область — исключение отдалённых кварталов внутри радиуса) —
ASSUMPTION, не требуется MVP, отдельный ADR при доказанной потребности.

---

## 6. Уведомления (`NotificationService`, D-23)

> Модуль `notifications` (`10-domain-model.md`: «`NotificationJob` application-уровня, без богатого
> домена»). `NotificationsFacade` подписывается на доменные события ЛЮБОГО модуля через `outbox`
> (уже установленный механизм, `SRS-DOM-151/152`) — не порождает собственных доменных событий,
> только потребляет.

### 6.1 Каналы

**SRS-ADM-051** **[R1]** [D-23, Charter §3.3] Provider Pattern уже установлен на уровне Charter:
`SmsProvider` (`SmsGatewayProvider`/`MockSmsProvider`), `PushProvider` (`WebPushProvider`/
`MockPushProvider`). Добавляются: `TelegramNotifyProvider` (единственная реализация —
Telegram Bot API, нет смысла в Mock для исходящих уведомлений бота, т.к. бот и есть основной канал
входа R1-13 — тестовое окружение использует тестовый Bot API токен, не отдельный класс) и
`InAppNotifyProvider` (тривиальный — просто запись в `notifications` с `channel='in_app'`,
читается клиентом через `GET /api/v1/notifications?filter[status]=queued,sent`, без внешнего
провайдера). Итого 4 канала: `telegram` (основной), `sms` (fallback), `web_push` (дополнительный,
для открытых вкладок браузера), `in_app` (гарантированный минимум — всегда пишется, даже если
остальные каналы недоступны).

**SRS-ADM-052** **[R1]** [Матрица событие × роль × канал] Таблица ниже расширяет WS-таблицу
`12-api-conventions...md` §6.3 (та — для мгновенного UI-обновления открытой вкладки/приложения;
эта — для АСИНХРОННОЙ доставки пользователю, который сейчас не смотрит в приложение).

| Событие (`outbox.event_type`) | Роль-получатель | Каналы (порядок = приоритет фолбэка) | Шаблон (`event_type` в `notification_templates`) |
|---|---|---|---|
| `OrderPaidEvent` | `customer` | `telegram → sms → web_push` (всегда + `in_app`) | `order.paid` |
| `OrderProcessingStartedEvent` | `customer` | `telegram → web_push` (без `sms` — не критично) | `order.processing_started` |
| `CourierAssignedEvent` | `customer`, `courier` | `telegram → sms → web_push` | `order.courier_assigned` |
| `OrderDeliveredEvent` | `customer` | `telegram → sms` | `order.delivered` |
| `OrderCancelledEvent`/`OrderAutoCancelledEvent` | `customer` | `telegram → sms → web_push` | `order.cancelled` |
| `OrderRefundedEvent` | `customer` | `telegram → sms` | `order.refunded` |
| `PayoutPaidEvent`/`PayoutDueEvent` | `pharmacy_admin` (сети) | `telegram → web_push` | `payout.status_changed` |
| `PrescriptionNeedsClarificationEvent` | `customer` | `telegram → web_push` | `prescription.needs_clarification` |
| `PrescriptionVerifiedEvent`/`RejectedEvent` | `customer` | `telegram` | `prescription.decision` |
| `InventorySyncBatchCompletedEvent` (`hasErrors=true`) | `pharmacy_admin` | `telegram → web_push` | `inventory.sync_errors` |
| `UnmatchedInventoryRowEvent` (агрегировано, не 1:1) | `pharmacy_admin` (дайджест раз/сутки) | `telegram` | `moderation.queue_digest` |
| `LicenseExpiringSoonEvent` | `pharmacy_admin` | `telegram → sms (при daysRemaining<=3) → web_push` | `onboarding.license_expiring` |
| `LicenseExpiredAutoSuspendEvent`/`PharmacySuspendedEvent` | `pharmacy_admin` | `telegram → sms` (эскалированный приоритет) | `onboarding.suspended` |
| `SlaBreachedEvent` | `support_agent`, `super_admin` | `web_push → in_app` (внутренний канал, не Telegram/SMS клиенту) | `ops.sla_breached` |
| `InvoiceOverdueEvent` (**[ДОПОЛНЕНИЕ]**, biling-инвойс просрочен) | `pharmacy_admin` | `telegram → sms` | `billing.invoice_overdue` |

**SRS-ADM-053** **[R1]** [`is_escrow_blocking` guard, R3-3] Given `support_tickets.category ∈
{'order_item_damaged_or_expired','order_quality_defect'}` создаётся в R1, When
`CreateSupportTicketUseCase` проверяет возможность установить `is_escrow_blocking=true`, Then флаг
ПРИНУДИТЕЛЬНО `false` вне зависимости от переданного клиентом значения — доменный конструктор
`OrderDispute` (созданиe спора) в R1 НЕ вызывается вообще (use case, отвечающий за атомарное
открытие `OrderDispute`, физически не задеплоен/скрыт за фиче-флагом `disputes_workflow_enabled=
false`, R3-3). Тикет в R1 остаётся ПРОСТЫМ обращением, разрешаемым `support_agent` вручную (перевод
`status → resolved/closed`, без финансовых последствий на `payout_schedule`).

### 6.2 Шаблоны

**SRS-ADM-054** **[R1]** [D-23, «шаблоны на tj/ru/en» из задания] **[ДОПОЛНЕНИЕ]** таблица
`notification_templates(event_type, channel, locale, subject?, body, variables_schema JSONB)` —
`body` — строка с плейсхолдерами `{{orderNumber}}`, `{{savingsDiram}}` и т.п. (движок подстановки —
простой `String.replace`, НЕ Handlebars/шаблонизатор общего назначения — минимизирует поверхность
инъекций в исходящий текст). `variables_schema` — Zod-подобное JSON-описание ожидаемых полей
payload'а события, используется в CI-тесте «каждый `event_type` в матрице §6.1 имеет шаблон на ВСЕХ
трёх локалях для КАЖДОГО назначенного канала» (`meta ⊆ variables_schema`, отсутствие — `500`
на этапе рендера, детектируется до продакшена автоматическим тестом, не в рантайме).

**SRS-ADM-055** **[R1]** `subject` заполняется ТОЛЬКО для `channel='email'` (в матрице §6.1 email
не используется активно ни для одного события R1 — enum оставлен для полноты будущего расширения,
не задействован в MVP-матрице) и `channel='web_push'` (заголовок нотификации браузера); для
`telegram`/`sms`/`in_app` — `subject=NULL` (одна строка текста).

**SRS-ADM-056** **[R1]** [D-01] Ни один шаблон НЕ содержит захардкоженного `brand.name` —
плейсхолдер `{{brandName}}` заполняется из `tenant.settings.brandName` в момент рендера (та же
гарантия, что и весь остальной UI, D-01 E2E-тест покрывает и текст уведомлений).

### 6.3 Дедупликация

**SRS-ADM-057** **[R1]** **[ДОПОЛНЕНИЕ]** `notifications.source_event_id UUID` (ссылка на
`outbox.id`) + `UNIQUE(user_id, channel, source_event_id)` (§10.1). Given `OutboxRelayWorker`
доставляет одно и то же событие потребителю `notifications` дважды (at-least-once, `SRS-DOM-152`),
When `DispatchNotificationUseCase` пытается вставить вторую запись с тем же `(user_id, channel,
source_event_id)`, Then `UNIQUE`-конфликт перехватывается КАК идемпотентный no-op (тот же паттерн
«insert or return existing», что и `payment_operations.idempotency_key`) — пользователь физически
не может получить одно и то же Telegram-сообщение дважды из-за повторной доставки очереди.

### 6.4 Тихие часы и настройки пользователя

**SRS-ADM-058** **[R1]** **[ДОПОЛНЕНИЕ]** таблица `notification_preferences(user_id, category,
channel, is_enabled, quiet_hours_start TIME, quiet_hours_end TIME)` (§10.1) — `category` — грубая
группировка событий (`'order_updates'`, `'promotions'`, `'onboarding_alerts'`, ...), НЕ 1:1
`event_type` (иначе UI настроек взрывается десятками переключателей). Критичные категории
(`'order_updates'` для активного заказа, `'delivery_otp'`) НЕ ИМЕЮТ переключателя отключения в UI
(`is_enabled` для них принудительно `true` на уровне Zod-схемы формы настроек — операционные
уведомления о собственном активном заказе нельзя выключить, только маркетинговые/дайджестные).

**SRS-ADM-059** **[R1]** Given `quiet_hours_start`/`quiet_hours_end` заданы (например,
`22:00–08:00` по `Asia/Dushanbe`, D-19 таймзона), When `DispatchNotificationUseCase` резолвит
момент отправки для НЕ-критичной категории, Then отправка ОТКЛАДЫВАЕТСЯ до конца тихих часов
(джоба-расписатель, не отбрасывается) — критичные категории (`order_updates` для активного заказа
— клиент ждёт курьера ночью, если заказ оформлен ночью) игнорируют тихие часы полностью (нельзя
молчать о статусе заказа, который сам пользователь инициировал в это время).

### 6.5 Гарантия доставки и ретраи

**SRS-ADM-060** **[R1]** [Charter §7, circuit breaker] Каждая попытка доставки — BullMQ job в
очереди `notification-dispatch`, retry policy: 3 попытки, экспоненциальный backoff (2с/8с/32с).
Given ВСЕ 3 попытки провалились (например, `SmsProvider` вернул 5xx трижды), When джоба
исчерпывает попытки, Then `notifications.status='failed'`, `failed_reason` заполнено, И система
АВТОМАТИЧЕСКИ пробует СЛЕДУЮЩИЙ канал по приоритету из матрицы §6.1 (не просто «сдаётся») — если
`sms` провалился, но `web_push`/`in_app` доступны, пользователь всё равно получает уведомление
каким-то каналом. Полный отказ ВСЕХ каналов для события — `notification-dispatch`-джоба помечает
запись для панели `apps/admin` («недоставленные уведомления», REQ-NOTIF-диагностика), но НЕ
блокирует основной бизнес-процесс (заказ продолжает обрабатываться независимо от того, узнал ли
клиент об этом мгновенно).

**SRS-ADM-061** **[R1]** [REQ-TG-5] `throttle_key` (уже в схеме `notifications`) реализует лимит
≤1 сообщение/сек на `telegram_chat_id` — при превышении BullMQ rate-limiter самой очереди (не
логика use case) откладывает доставку, НЕ отбрасывает (`notifications.status` остаётся `'queued'`
до момента фактической отправки в пределах лимита, не `'suppressed_rate_limit'` — этот статус
зарезервирован для случая, когда СОЗНАТЕЛЬНО решено не отправлять дубль по дедупликации §6.3, а не
для временной задержки лимитом).

---

## 7. `audit_log`

**SRS-ADM-062** **[R1]** [Часть C п.13 решений архитектора] Обязательные к логированию категории
(`audit_action_category`, уже определён `11-database-schema.md`) и конкретные триггеры:

| Категория | Что именно пишет запись |
|---|---|
| `payment_override` | `AdminPaymentOverrideUseCase` (§4.3, **SRS-ADM-032**) — каждый ручной перевод статуса оплаты |
| `return_override` | `admin_return_override` (R3, специфицировано `10-domain-model.md` `SRS-DOM-056`) |
| `dispute_resolution` | Каждый терминальный переход `OrderDispute` (R3) — `resolved_by_user_id`/`role`/`reason` уже пишутся в саму строку `order_disputes` (§«Группа F»), `audit_log` дублирует для универсальной выгрузки комплаенса |
| `prescription_access` | Каждый просмотр `prescription_image_url` ролью `super_admin` (`SRS-DOM-155в`) — **НЕ** для `customer`/`pharmacist` (их доступ — правило владения, не аномалия, требующая аудита) |
| `control_category_change` | `PATCH .../control-category` (§3.2, **SRS-ADM-024**) |
| `onboarding_decision` | Дублирует `onboarding_review_log` (§2, специализированная таблица) — здесь для единой комплаенс-выгрузки по всем категориям сразу |
| `force_cancel_order` | `ForceCancelIncompleteOrdersUseCase` (§2.4) и `AdminForceCancelOrderUseCase` (§4.3) |
| `ledger_adjustment` | `resolveAdjustment` (R3, `SRS-DOM-063`) |
| `role_grant` (**[ДОПОЛНЕНИЕ]**, §10.1) | `POST /users/:id/grant-platform-role` (§4.2, **SRS-ADM-030**) |

**SRS-ADM-063** **[R1]** Формат `metadata` (JSONB) — единая форма для ВСЕХ категорий:
`{ before?: Record<string, unknown>, after?: Record<string, unknown>, requestId: UUID, extra?:
Record<string, unknown> }`. `before`/`after` содержат ТОЛЬКО изменившиеся поля (не полный снепшот
сущности — избыточно для append-only таблицы, растущей на каждое административное действие), НИКОГДА
не содержат сырые секреты (`apiKey`, `hmacSecret`, `code_hash` — те же поля, что маскируются в
`pino`, §5.4) — сериализатор записи в `audit_log` использует ТОТ ЖЕ список маскируемых полей, что
логгер (`packages/contracts/src/sensitive-fields.ts`, единый источник, чтобы список не разошёлся).

**SRS-ADM-064** **[R1]** [Неизменяемость] `audit_log` — append-only на ДВУХ уровнях защиты: (1)
архитектурный — ни один репозиторий `AuditLogRepository` не экспонирует `update()`/`delete()`
методы (домен/application физически не может их вызвать); (2) эксплуатационный —
`REVOKE UPDATE, DELETE ON audit_log FROM app_role;` в миграции (та же гарантия, что уже применена
к `escrow_ledger`, §10.1 повторяет DDL). Оба уровня одновременно, а не один вместо другого —
архитектурный уровень ловит баг на code review, эксплуатационный — защищает от компрометации самого
приложения (SQL-инъекция/скомпрометированный сервис-аккаунт всё равно не может стереть след).

**SRS-ADM-065** **[R1]** [Доступ на чтение] `GET /api/v1/audit-log` — ТОЛЬКО `super_admin`
(`audit-log:read`, уже установлено §4.1 `12-api-conventions...md`). Ни `pharmacy_admin`, ни
`support_agent` не имеют доступа даже к записям, касающимся ИХ СОБСТВЕННЫХ действий (например,
`pharmacy_admin` не видит, что `super_admin` просматривал prescription-изображение по его заказу)
— единый принцип: аудит существует ДЛЯ надзора над платформой, а не как пользовательский лог
активности.

**SRS-ADM-066** **[R1]** [Срок хранения] `AUDIT_LOG_RETENTION_YEARS` (ASSUMPTION 5 лет — типичный
срок фискальной/юридической проверки в РТ для документов, связанных с деньгами и рецептурными
препаратами; подлежит утверждению юристом заказчика, аналогично прочим `ASSUMPTION` этого проекта).
`prescription_access`-записи (доступ к медданным) НЕ удаляются НИКОГДА автоматически — REQ-REG-10/11
трактуется как требование к неограниченному хранению именно этой категории (медданные подпадают под
отдельный, более строгий режим комплаенса, чем финансовый аудит). Фоновая джоба `AuditLogRetention
Job` удаляет записи категорий, НЕ РАВНЫХ `prescription_access`, старше `AUDIT_LOG_RETENTION_YEARS` —
раз в квартал, батчами (не блокирующий `DELETE` по всей таблице разом).

---

## 8. Аналитика и отчёты

### 8.1 Ключевые метрики продукта

**SRS-ADM-067** **[R1]** [R1-15, пивот §5.2 «позиционирование»] **[ДОПОЛНЕНИЕ]** append-only
таблица `product_events` (§10.1) — источник продуктовой воронки, отдельно от `outbox` (тот —
транспорт доменных событий между МОДУЛЯМИ; этот — накопление для АНАЛИТИКИ, включает и события, у
которых нет доменного смысла, например `search_performed`, `analog_card_viewed` — чисто UX-
телеметрия, не порождающая никаких доменных последствий). Пишется из `presentation`-слоя фронтенда
через `POST /api/v1/analytics/events` (батчируемый, `fire-and-forget`, `202 Accepted` немедленно —
аналитика НЕ должна замедлять пользовательский путь) И из backend use case напрямую там, где
событие уже известно серверу (`order_placed` пишется из `CheckoutUseCase`, не полагается на клиент).

**SRS-ADM-068** **[R1]** [Пивот §5.2: «ключевая метрика — экономия пользователя в сомони»]
Обязательные типы `product_events.event_type` для расчёта воронки из пивота: `search_performed`,
`analog_shown` (карточка аналога отрендерена с `savingsDiram`), `analog_clicked`, `added_to_cart`
(с `medicineId`, `pharmacyId`, `savingsDiramAtAdd` — снэпшот экономии на момент добавления, т.к.
цена аптеки может измениться до заказа), `order_placed` (со ссылкой `orderId` — связывает воронку с
`orders`, позволяя посчитать РЕАЛИЗОВАННУЮ, а не только показанную экономию:
`Σ savingsDiram по order_items, где medicine соответствует ранее показанному дешёвому аналогу`).

**SRS-ADM-069** **[R1]** `GET /api/v1/analytics/funnel?period=2026-08&tenantId=...` (`super_admin`,
агрегированный дашборд) возвращает воронку: `{ searchPerformed, analogShown, analogClicked,
addedToCart, orderPlaced, conversionRates: { shownToClicked, clickedToCart, cartToOrder,
overallShownToOrder } }` + `totalSavingsShownDiram`/`totalSavingsRealizedDiram` (реализованная —
только по факту `order_placed` с выбранным дешёвым аналогом). Это ПРЯМОЙ вход для kill-критерия #1
пивота («доля кликнувших на аналог и дошедших до заказа близка к нулю» — §7 `04-SCOPE-DECISION`).

**SRS-ADM-070** **[R1]** Дополнительные метрики платформы (`GET /api/v1/analytics/platform-
metrics?period=...`): `gmvDiram` (Σ `orders.total_amount` за period, `status ∈ {delivered}` —
GMV признаётся по факту доставки, не по факту заказа, консервативная методология), `averageCheck
Diram` (`gmvDiram / count(orders)`), `pickupSlaComplianceRate` (доля заказов с
`picked_up_at - processing_started_at <= pickup_sla_minutes`), `deliverySlaComplianceRate`
(аналогично для `delivered_at - picked_up_at` относительно `delivery_sla_city/remote_minutes`),
`cancellationRate` (`count(cancelled) / count(всего)`), `activePharmaciesSendingDataRate`
(доля аптек со `status='active'`, у которых `inventory_sync_batches` за последние 7 дней содержит
хотя бы одну запись ЛЮБОГО канала — прямой вход для kill-критерия #2: «менее 3 из 5–10 пилотных
аптек готовы присылать данные»).

### 8.2 Отчёты для аптеки и платформы

**SRS-ADM-071** **[R1]** Отчёт аптеки — уже специфицирован §5.5 (`GET .../reports/sales`).
Дополнительно: `GET /api/v1/pharmacy-accounts/:id/reports/inventory-health` (доля позиций с
просроченным `last_synced_at` относительно `INVENTORY_DELTA_SLA_MINUTES`, доля позиций с
`stock_quantity=0`, ближайшие к истечению партии по FEFO) — помогает аптеке САМОЙ увидеть проблему
актуальности данных ДО того, как её увидит клиент как «данные могут быть неактуальны» (D-04).

**SRS-ADM-072** **[R1]** Отчёт платформы (`super_admin`, дашборд `apps/admin`): тренд GMV/воронки
по неделям (график, не таблица — назначение для быстрого визуального контроля kill-критериев),
таблица «Топ аналогов по показанной экономии» (`medicineId`, `avgSavingsDiram`,
`timesShown`, `conversionToOrder`) — прямая проверка REQ-MARKET-3/гипотезы пивота на реальных
данных, а не предположении. Воронка онбординга аптек (`GET /api/v1/analytics/onboarding-funnel`):
среднее время `submitted_at → resolved_at` по статусам решения (approve/reject) — вход для
REQ-ONBOARD-18 SLA-мониторинга на агрегированном уровне (не по одной заявке, как §2.2, а тренд).

### 8.3 Экспорт

**SRS-ADM-073** **[R1]** `GET /api/v1/reports/:reportType/export?format=csv|xlsx&period=...` —
для периодов ≤31 дня ответ синхронный (`Content-Disposition: attachment`, поток без сохранения на
диск). Для периодов >31 дня — асинхронный: `202 Accepted { data: { exportJobId } }`, worker
(`GenerateReportExportJob`, BullMQ) формирует файл, загружает в MinIO (`ObjectStorageProvider`,
bucket `report-exports`, TTL объекта 7 дней — не бессрочное хранение отчётов), клиент опрашивает
`GET /api/v1/reports/export-jobs/:exportJobId` (`status: 'processing'|'ready'|'failed'`, при
`ready` — `{ downloadUrl }`, подписанный URL с истечением 1 час) ИЛИ получает WS-событие
`report.export_ready` (комната `customer:{userId}`-подобная `staff:{userId}`, внутренний, не
добавляется в публичную таблицу §6.3 `12-api-conventions...md`, т.к. специфичен только для этого
модуля — отдельная строка добавляется туда при следующей редакции документа).

---

## 9. Поддержка (D-24)

> Полный workflow споров/возвратов — **[R3]** (см. таблицу релизов и **SRS-ADM-053**). Ниже —
> облегчённая очередь обращений, доступная с R1.

**SRS-ADM-074** **[R1]** [REQ-DISPUTE-1] `POST /api/v1/support-tickets { orderId?, channel,
category, description }` — доступно `customer` (свои заказы), создаётся автоматически
(`channel='system_auto'`) при просрочке `delivery_sla` (REQ-DISPUTE-16 — механизм детекции просрочки
уже существует независимо от R3-статуса самого спора: джоба `DeliverySlaMonitorJob` мониторит
`delivered_at IS NULL AND now() > sla_deadline`, создаёт тикет ВСЕГДА, вне зависимости от того,
включён ли R3-workflow резолюции спора — тикет как факт нужен для статистики поддержки уже в R1).

**SRS-ADM-075** **[R1]** [SLA первого ответа] **[ДОПОЛНЕНИЕ]** `support_tickets.first_response_
due_at`/`first_responded_at` (§10.1 — текущая схема несёт только `resolution_due_at` на уровне
`order_disputes`, не на уровне самого тикета; тикет без эскроу-блокировки в R1 не имеет связанного
`OrderDispute`, поэтому нуждается в СОБСТВЕННОМ SLA-поле). `first_response_due_at = created_at +
SUPPORT_FIRST_RESPONSE_SLA_MINUTES` (ASSUMPTION 60 минут в рабочие часы поддержки). Первое
изменение `status: open → in_progress` ИЛИ первый комментарий `support_agent` фиксирует
`first_responded_at` — используется для отчёта SLA-соответствия поддержки (§8.2-подобный дашборд,
`GET /api/v1/analytics/support-sla`).

**SRS-ADM-076** **[R1]** [Эскалация] Джоба `SupportSlaMonitorJob` (аналог `DeliverySlaMonitorJob`)
проверяет `first_response_due_at < now() AND first_responded_at IS NULL` → повышает
`support_tickets`-приоритет (**[ДОПОЛНЕНИЕ]** поле `priority SMALLINT` аналогично `order_disputes.
priority`, §10.1) и публикует `SlaBreachedEvent` (уже существующий тип, `entityType='support_
ticket'`) → уведомление `super_admin` (матрица §6.1).

**SRS-ADM-077** **[R3]** Связь со спорами (`is_escrow_blocking → OrderDispute`), резолюция с
финансовыми последствиями (`resolve-reject`/`resolve-refund-*`/`resolve-adjustment`),
`confirm-tenant-refund` — полностью специфицированы `10-domain-model.md` (`SRS-DOM-057..063`,
state machine §5.3) и `12-api-conventions...md` (RBAC §4.1, permission-строки
`disputes:resolve-*`) — не переоткрываются здесь, ТОЛЬКО подтверждается их release-метка **R3** и
факт, что use case-код существует за фиче-флагом `disputes_workflow_enabled` (§6.1 **SRS-ADM-053**),
не удаляется из кодовой базы, а физически недостижим до включения флага.

---

## 10. Дополнения к схеме БД

> Каждое поле/таблица ниже ОТСУТСТВУЕТ в `11-database-schema.md` и вводится ЭТИМ документом с
> обоснованием, как того требует правило приоритета источников. Именование, типы и конвенции —
> те же, что в §«Принципы» `11-database-schema.md` (диримы `BIGINT`, TJS `NUMERIC(10,2)` только
> для отображаемых сумм, `TIMESTAMPTZ` для меток времени).

### 10.1 Новые таблицы и поля

```sql
-- =====================================================================================
-- feature_flags [ДОПОЛНЕНИЕ §4.1 SRS-ADM-028 — гейт R2/R3-функциональности без деплоя]
-- =====================================================================================
CREATE TABLE feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_key VARCHAR(100) NOT NULL, -- 'prescription_ocr_pipeline_enabled' | 'disputes_workflow_enabled' | ...
    scope VARCHAR(10) NOT NULL DEFAULT 'global', -- 'global' | 'tenant'
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NOT NULL только при scope='tenant'
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    rollout_percentage SMALLINT NOT NULL DEFAULT 100, -- 0..100, для постепенного включения
    description TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_feature_flags_scope_tenant CHECK (
        (scope = 'global' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL)
    ),
    CONSTRAINT chk_feature_flags_rollout_range CHECK (rollout_percentage BETWEEN 0 AND 100),
    CONSTRAINT uq_feature_flags_key_scope UNIQUE (flag_key, scope, tenant_id)
);
COMMENT ON TABLE feature_flags IS
    'SRS-ADM-028. Резолвинг: per-tenant запись переопределяет global той же flag_key (та же логика '
    'специфичности, что platform_fee, без дат действия). Обязательный R1-флаг '
    'prescription_ocr_pipeline_enabled гейтит R2-4 (04-SCOPE-DECISION §4).';

-- =====================================================================================
-- notification_templates [ДОПОЛНЕНИЕ §6.2 SRS-ADM-054 — шаблоны уведомлений tj/ru/en]
-- =====================================================================================
CREATE TABLE notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL, -- ключ матрицы SRS-ADM-052, напр. 'order.paid'
    channel notification_channel NOT NULL,
    locale VARCHAR(5) NOT NULL, -- 'tj' | 'ru' | 'en'
    subject TEXT, -- заполнено только для channel IN ('email','web_push')
    body TEXT NOT NULL, -- плейсхолдеры {{var}}, простая подстановка (не шаблонизатор общего назначения)
    variables_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notification_templates UNIQUE (event_type, channel, locale)
);
COMMENT ON TABLE notification_templates IS
    'SRS-ADM-054/056. brandName ВСЕГДА плейсхолдер {{brandName}}, никогда не хардкод (D-01). '
    'CI-тест проверяет полноту матрицы: каждая (event_type, channel) из SRS-ADM-052 имеет строку '
    'на всех трёх locale.';

-- =====================================================================================
-- notification_preferences [ДОПОЛНЕНИЕ §6.4 SRS-ADM-058 — настройки пользователя, тихие часы]
-- =====================================================================================
CREATE TABLE notification_preferences (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL, -- 'order_updates' | 'promotions' | 'onboarding_alerts' | ...
    channel notification_channel NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, category, channel)
);
COMMENT ON TABLE notification_preferences IS
    'SRS-ADM-058/059. Критичные категории (order_updates для активного заказа, delivery_otp) '
    'принудительно is_enabled=true и игнорируют quiet_hours на уровне application-валидации формы '
    '(не редактируемы пользователем), остальные — свободно настраиваемы.';

-- =====================================================================================
-- РАСШИРЕНИЕ notifications [ДОПОЛНЕНИЕ §6.3 SRS-ADM-057 — дедупликация по событию]
-- =====================================================================================
ALTER TABLE notifications ADD COLUMN source_event_id UUID; -- ссылка на outbox.id, породивший уведомление
ALTER TABLE notifications ADD CONSTRAINT uq_notifications_dedup
    UNIQUE (user_id, channel, source_event_id);
COMMENT ON COLUMN notifications.source_event_id IS
    'SRS-ADM-057: at-least-once доставка outbox (SRS-DOM-152) не должна порождать дубль исходящего '
    'уведомления — UNIQUE-конфликт перехватывается как идемпотентный no-op.';

-- добавление канала in_app к notification_channel (SRS-ADM-051), ВНЕ транзакции (SRS-DB-009)
-- отдельный файл миграции с пометкой -- disable-transaction
ALTER TYPE notification_channel ADD VALUE 'in_app';

-- =====================================================================================
-- medicine_merge_log [ДОПОЛНЕНИЕ §3.2 SRS-ADM-025 — аудит слияния дублей каталога]
-- =====================================================================================
CREATE TABLE medicine_merge_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE RESTRICT,
    target_medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE RESTRICT,
    merged_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_medicine_merge_not_self CHECK (source_medicine_id != target_medicine_id)
);
COMMENT ON TABLE medicine_merge_log IS
    'SRS-ADM-025/026. source остаётся в medicines (is_published=false) ради исторической целостности '
    'order_items.medicine_id. Наличие строки с source_medicine_id=X блокирует повторное объединение X '
    '(SRS-ADM-026).';

-- =====================================================================================
-- product_events [ДОПОЛНЕНИЕ §8.1 SRS-ADM-067/068 — продуктовая воронка (R1-15)]
-- =====================================================================================
CREATE TABLE product_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL допустим для гостя (session_id — ключ)
    session_id VARCHAR(128) NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'search_performed'|'analog_shown'|'analog_clicked'|'added_to_cart'|'order_placed'|...
    medicine_id UUID REFERENCES medicines(id) ON DELETE SET NULL,
    pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    savings_diram BIGINT, -- снэпшот экономии на момент события (analog_shown/added_to_cart)
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE product_events IS
    'SRS-ADM-067/068/069. Append-only, subscriber-only (analytics read-side, не влияет на доменные '
    'инварианты). Источник воронки showed->clicked->cart->order и метрики "экономия сомони" — прямой '
    'вход для kill-критериев 1/2 (04-SCOPE-DECISION §7). НЕ путать с outbox: outbox — межмодульный '
    'транспорт доменных событий, product_events — чисто аналитическая телеметрия, включает события '
    'без доменного значения (search_performed).';
CREATE INDEX idx_product_events_tenant_type_time ON product_events (tenant_id, event_type, occurred_at);
CREATE INDEX idx_product_events_session ON product_events (session_id, occurred_at);

-- =====================================================================================
-- РАСШИРЕНИЕ pharmacies [ДОПОЛНЕНИЕ §5.6 SRS-ADM-050 — простая круговая зона доставки]
-- =====================================================================================
ALTER TABLE pharmacies ADD COLUMN max_delivery_radius_km NUMERIC(5, 2) NOT NULL DEFAULT 10.0;
COMMENT ON COLUMN pharmacies.max_delivery_radius_km IS
    'SRS-ADM-050. Круговая зона от geo_point (R1) — согласована с формулой delivery_fee_tjs '
    '(haversine, REQ-DELIV-1). Полигональные зоны — вне MVP, отдельный ADR при потребности.';

-- =====================================================================================
-- РАСШИРЕНИЕ pharmacy_verification [ДОПОЛНЕНИЕ §2 SRS-ADM-012/017 — причина повторной проверки, отзыв]
-- =====================================================================================
ALTER TABLE pharmacy_verification ADD COLUMN review_reason VARCHAR(30) NOT NULL DEFAULT 'initial';
    -- 'initial' | 'address_change' | 'reactivation'
ALTER TABLE pharmacy_verification ADD COLUMN revoked_at TIMESTAMPTZ;
ALTER TABLE pharmacy_verification ADD COLUMN revoked_reason TEXT;
ALTER TABLE pharmacy_verification ADD COLUMN revoked_by UUID REFERENCES users(id) ON DELETE SET NULL;
-- добавление значения 'revoked' к verification_status, ВНЕ транзакции (SRS-DB-009)
ALTER TYPE verification_status ADD VALUE 'revoked';
COMMENT ON COLUMN pharmacy_verification.review_reason IS
    'SRS-ADM-012: отличает первичную заявку от повторной проверки (смена адреса/реактивация) в UI '
    'очереди оператора — не требует повторной сверки лицензии с нуля для address_change.';

-- =====================================================================================
-- РАСШИРЕНИЕ support_tickets [ДОПОЛНЕНИЕ §9 SRS-ADM-075/076 — SLA первого ответа, приоритет]
-- =====================================================================================
ALTER TABLE support_tickets ADD COLUMN first_response_due_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN first_responded_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN priority SMALLINT NOT NULL DEFAULT 0;
COMMENT ON COLUMN support_tickets.first_response_due_at IS
    'SRS-ADM-075: SLA тикета, НЕЗАВИСИМЫЙ от order_disputes.resolution_due_at (тот существует только '
    'для is_escrow_blocking=true, недостижимо в R1 согласно SRS-ADM-053).';

-- =====================================================================================
-- РАСШИРЕНИЕ audit_action_category [ДОПОЛНЕНИЕ §4.2/§7 SRS-ADM-030/062 — выдача платформенной роли]
-- =====================================================================================
ALTER TYPE audit_action_category ADD VALUE 'role_grant'; -- ВНЕ транзакции (SRS-DB-009)

-- =====================================================================================
-- Операционные REVOKE [ДОПОЛНЕНИЕ §7 SRS-ADM-064 — неизменяемость audit_log]
-- =====================================================================================
REVOKE UPDATE, DELETE ON audit_log FROM app_role;
```

**SRS-ADM-078** **[R1]** [`SRS-DB-009`] Все `ALTER TYPE ... ADD VALUE` выше — отдельные файлы
миграций с пометкой `-- disable-transaction` (PostgreSQL запрещает использование нового значения
enum в той же транзакции, где оно добавлено — правило уже установлено `11-database-schema.md`).

**SRS-ADM-079** **[R1]** [`Drizzle`, `02` §1.1] Domain и application НЕ импортируют
Drizzle-схему этих новых таблиц напрямую (то же правило, что и для остальной схемы,
`SRS-DOM-001`-подобное) — репозитории `FeatureFlagsRepository`, `NotificationTemplateRepository`,
`ProductEventsRepository` живут в `infrastructure` соответствующих модулей (`moderation`/
`notifications`/`analytics`), возвращают доменные/application DTO, не строки Drizzle.

### 10.2 Новые коды ошибок

> Расширяет каталог `12-api-conventions-auth-tenancy.md` §2.1 (тот же `ErrorCode` enum в
> `packages/contracts/src/errors.ts`, маппинг через тот же `TransportExceptionFilter`/
> `DomainExceptionFilter` — не заводится третий фильтр ошибок для этого модуля).

| Code | HTTP | Источник | RU |
|---|---|---|---|
| `CHAIN_APPLICATION_ALREADY_EXISTS` | 409 | **SRS-ADM-007** | Заявка с этим ИНН уже существует в активной обработке |
| `ALREADY_REVIEWED` | 409 | **SRS-ADM-080** | Заявка уже рассмотрена другим оператором |
| `MEDICINE_ALREADY_MERGED` | 409 | **SRS-ADM-026**, **SRS-ADM-082** | Медикамент уже объединён с другой позицией каталога |
| `DELIVERY_ZONE_EXCEEDED` | 422 | **SRS-ADM-050** | Адрес доставки вне зоны обслуживания аптеки |
| `LICENSE_ALREADY_EXPIRED` | 422 | **SRS-ADM-086** | Срок действия лицензии истёк на дату принятия решения |

---

## 11. Пограничные случаи и ошибки

**SRS-ADM-080** **[R1]** [Гонка: два оператора одновременно открывают одну заявку] Given два
`super_admin` открывают КАРТОЧКУ одной и той же `pending_review`-заявки одновременно и оба нажимают
`approve`/`reject` почти одновременно, When второй запрос долетает до БД, Then `SELECT ... FOR
UPDATE` на строку `pharmacy_chains`/`pharmacies` (тот же паттерн, что `SRS-DOM-165`) сериализует
запросы — второй запрос видит уже изменённый `status` (например, уже `approved`) и получает
`409 CONFLICT` `{ code: 'ALREADY_REVIEWED' }` (**[ДОПОЛНЕНИЕ кода ошибки]**), а не тихий двойной
`onboarding_review_log`.

**SRS-ADM-081** **[R1]** [Дубликат `catalog_match_queue`-строки для одной и той же несматченной
позиции] Given аптека повторно присылает ТУ ЖЕ несопоставленную строку (например, повторный полный
Excel-импорт до разрешения предыдущей очереди), When `UnmatchedInventoryRowEvent` публикуется
повторно, Then дедупликация УЖЕ установлена на уровне события (`10-domain-model.md`: хеш
`(pharmacyId, internal_sku)`, не создаёт вторую строку очереди) — здесь подтверждается: оператор
модерации НИКОГДА не видит дублирующихся карточек одной и той же нерешённой позиции, даже при сотнях
повторных выгрузок.

**SRS-ADM-082** **[R1]** [Слияние медикамента, на который ссылается ОТКРЫТАЯ заявка модерации]
Given `catalog_match_queue`-строка ссылается на `fuzzy_candidate_medicine_id = X`, When `X`
сливается в `Y` ДО того, как оператор разрешил эту строку очереди, Then `ResolveCatalogMatchQueue
ItemUseCase` при попытке `match_existing(medicineId=X)` возвращает `409 CONFLICT
{ code: 'MEDICINE_ALREADY_MERGED', mergedInto: Y }` — UI автоматически предлагает подставить `Y`
вместо `X` (клиент делает повторный запрос с `medicineId=Y`), не требуя от оператора искать замену
вручную.

**SRS-ADM-083** **[R1]** [Отзыв верификации сети с активными заказами у дочерних аптек] Given
`RevokeVerificationUseCase` вызван для `PharmacyChain`, у дочерних `PharmacyAccount` есть заказы в
`paid_escrow`/`processing`, When каскадный `suspend(reason='license_revoked')` применяется к КАЖДОЙ
точке, Then судьба заказов подчиняется УЖЕ установленному правилу `SRS-DOM-161`
(`reason='license_revoked'` → требуется ОТДЕЛЬНОЕ явное `force-cancel-incomplete-orders`, не
побочный эффект) — отзыв верификации сети НЕ отменяет заказы автоматически, оператор видит
предупреждение «N дочерних точек имеют незавершённые заказы» и обязан явно решить их судьбу
каждой точкой (`force-cancel` не выполняется массово по всей сети одним кликом — предотвращает
случайный полный рефанд при одиночной ошибочной точке).

**SRS-ADM-084** **[R1]** [Провайдер уведомлений недоступен целиком (все 4 канала)] Given
`TelegramNotifyProvider`, `SmsProvider`, `WebPushProvider` одновременно недоступны (маловероятный,
но возможный сбой инфраструктуры), When `DispatchNotificationUseCase` пытается доставить, Then
`in_app`-запись ВСЕГДА создаётся первой и синхронно (не через очередь, отдельный путь записи в БД
внутри того же use case, до постановки внешних каналов в очередь) — гарантия «пользователь как
минимум увидит уведомление при следующем открытии приложения» не зависит от здоровья ВНЕШНИХ
провайдеров вообще.

**SRS-ADM-085** **[R1]** [Экспорт отчёта: worker падает после загрузки файла в MinIO, до отметки
`ready`] Given `GenerateReportExportJob` успешно загрузил файл в MinIO, но упал ДО `UPDATE
export_jobs SET status='ready'` (крах процесса), When BullMQ ретраит джобу (at-least-once), Then
повторный запуск ПЕРЕЗАПИСЫВАЕТ тот же объект MinIO по детерминированному ключу
(`report-exports/{exportJobId}.csv`, не случайному имени) — идемпотентно, старый частично
загруженный файл просто перезаписывается, не накапливает мусорные версии.

**SRS-ADM-086** **[R1]** [Оператор пытается одобрить аптеку с истёкшей на дату решения лицензией]
Given `pharmacies.license_expiry_date <= CURRENT_DATE` на момент вызова `approve` (заявитель
предоставил уже просроченный скан или проверка затянулась дольше срока действия), When
`ReviewPharmacyApplicationUseCase.approve()` выполняется, Then `422 BUSINESS_RULE_VIOLATION`
`{ code: 'LICENSE_ALREADY_EXPIRED' }` (**[ДОПОЛНЕНИЕ кода ошибки]**) — оператор ОБЯЗАН либо
запросить `request-changes` (новый скан актуальной лицензии), либо `reject`; `approve` физически
недостижим для уже просроченной на дату решения лицензии, независимо от намерения оператора.

**SRS-ADM-087** **[R1]** [Фиче-флаг меняется во время выполнения долгой операции] Given
`prescription_ocr_pipeline_enabled=true` в момент, когда клиент начал загрузку фото рецепта, When
`super_admin` выключает флаг ДО завершения OCR-джобы, Then УЖЕ ПОСТАВЛЕННАЯ в очередь джоба
доводится до конца (флаг проверяется ТОЛЬКО в момент постановки новой задачи —
`PrescriptionOcrRequestedEvent`, не при каждом шаге обработки уже принятой) — предотвращает
«зависшие» состояния `ocr_processing` из-за флага, переключённого посреди обработки.

**SRS-ADM-088** **[R1]** [Тихие часы разных тенантов в разных практических часовых поясах]
Given `quiet_hours_start/end` хранятся как `TIME` без явной привязки к часовому поясу пользователя
(вся платформа физически работает в РТ, `Asia/Dushanbe`, D-19 конвенция), When резолвится момент
отправки, Then используется ЕДИНАЯ таймзона `Asia/Dushanbe` для ВСЕХ тенантов (White-Label сети
физически в той же стране) — мультичасовое White-Label вне MVP-скоупа, отдельный ADR при выходе за
пределы РТ.

**SRS-ADM-089** **[R1]** [Попытка `bulk-resolve` с частично уже разрешёнными строками] Given
массив `ids` в `bulk-resolve` содержит и `pending_review`, и уже `matched`/`rejected` строки
(например, второй оператор успел обработать одну из них между открытием списка и кликом «применить
ко всем»), When запрос обрабатывается, Then use case обрабатывает ТОЛЬКО строки в `pending_review`
на момент транзакции, возвращает `{ resolved: number, skipped: number, skippedIds: UUID[] }` —
частичный успех НЕ откатывает уже применённые строки (не атомарно по всему массиву — каждая строка
независима, атомарность не пересекает границы независимых доменных объектов).

---

## Тестовые сценарии

> Формат — как в `10-domain-model.md`: `TC-ADM-nnn` → проверяет `SRS-ADM-nnn`. Включены позитивные
> и негативные кейсы.

| TC | Проверяет | Given | When | Then |
|---|---|---|---|---|
| TC-ADM-001 | SRS-ADM-005 | Заявка аптеки без `chainId` | `POST /pharmacy-accounts` | Создан `PharmacyChain` с одной точкой прозрачно, пользователь видит одну форму |
| TC-ADM-002 | SRS-ADM-007 | `pharmacy_chains` с `tin_inn=X, status='rejected'` | Повторная `POST /pharmacy-chains` с тем же `tinInn` | Существующая строка `rejected→draft`, НЕ создан дубль (нет `409` по `UNIQUE(tin_inn)`) |
| TC-ADM-003 | SRS-ADM-007 | `tin_inn=X, status='active'` | Повторная заявка с тем же `tinInn` | `409 CHAIN_APPLICATION_ALREADY_EXISTS` |
| TC-ADM-004 | SRS-ADM-013 | Аптека `status='pending_review'`, остатки загружены | Публичный `GET /medicines/search` | Аптека НЕ появляется в результатах |
| TC-ADM-005 | SRS-ADM-014 | Аптека `status='draft'` | `pharmacy_admin` этой заявки вызывает `POST /inventory/batch-update` | `202`, батч принят и обработан несмотря на `draft` |
| TC-ADM-006 | SRS-ADM-015 | Аптека `status='approved'` (сеть ещё `pending_review`) | `POST /orders` на эту аптеку | `422 PHARMACY_SUSPENDED` |
| TC-ADM-007 | SRS-ADM-017 | `pharmacy_verification.verification_status='verified'` | `POST /pharmacy-verifications/:id/revoke` | Статус `→'revoked'`, каскадный `suspend(license_revoked)` на все точки субъекта |
| TC-ADM-008 | SRS-ADM-017 | `verification_status='not_started'` | Попытка `revoke` | `409 CONFLICT` — revoke неприменим к ещё не одобренному субъекту |
| TC-ADM-009 | SRS-ADM-018 | `license_expiry_date = today+30` | Джоба `LicenseExpiryCheckJob` | `LicenseExpiringSoonEvent(daysRemaining=30)` опубликовано РОВНО один раз |
| TC-ADM-010 | SRS-ADM-018 | `license_expiry_date = today - 1` | Джоба выполняется | `pharmacyAccount.suspend('license_expired')` вызван системным актором, без участия человека |
| TC-ADM-011 | SRS-ADM-021 | `catalog_match_queue`-строка, `action='create_new'`, `newMedicineDraft` без `substances` | `POST .../resolve` | `400 VALIDATION_ERROR` — `substances.min(1)` не пройден |
| TC-ADM-012 | SRS-ADM-022 | 5 из 10 `ids` в bulk-запросе уже НЕ `pending_review` | `POST /bulk-resolve` | `resolved=5, skipped=5`, обработанные строки не откатываются |
| TC-ADM-013 | SRS-ADM-024 | `PATCH .../control-category` без `reason` | Запрос | `400 VALIDATION_ERROR` (Zod, `reason` обязателен) |
| TC-ADM-014 | SRS-ADM-025/026 | `medicine A` уже смёржен в `B` ранее | Повторный `merge-into` для той же пары `A→B` | `409 MEDICINE_ALREADY_MERGED` |
| TC-ADM-015 | SRS-ADM-032 | `orders.status='pending_payment'` | `POST /payment-override` без `reason` | `400 VALIDATION_ERROR` — `reason.min(10)` |
| TC-ADM-016 | SRS-ADM-032 | Валидный `payment-override` вызов | Успешное выполнение | Запись `audit_log(category='payment_override')` создана в ТОЙ ЖЕ транзакции, что смена статуса |
| TC-ADM-017 | SRS-ADM-044 | Ключ 1С только что создан | Любой ПОСЛЕДУЮЩИЙ `GET`-запрос | Полный `apiKey`/`hmacSecret` НИГДЕ не встречается в ответе/логах, только `keyPrefix` |
| TC-ADM-018 | SRS-ADM-045 | Ротация ключа 1С | В течение `API_KEY_ROTATION_GRACE_PERIOD_HOURS` | Оба ключа (старый и новый) валидны параллельно |
| TC-ADM-019 | SRS-ADM-045 | Прошло `API_KEY_ROTATION_GRACE_PERIOD_HOURS` после ротации | Запрос со СТАРЫМ ключом | `401 PHARMACY_API_KEY_INVALID` |
| TC-ADM-020 | SRS-ADM-050 | `pharmacy.max_delivery_radius_km=5`, клиент в 7 км | `POST /orders` на эту аптеку | `422 DELIVERY_ZONE_EXCEEDED` |
| TC-ADM-021 | SRS-ADM-053 | R1, флаг `disputes_workflow_enabled=false` | `POST /support-tickets { category: 'order_item_damaged_or_expired' }` | `is_escrow_blocking` принудительно `false`, `order_disputes` НЕ создаётся |
| TC-ADM-022 | SRS-ADM-057 | Уведомление уже отправлено для `(user_id, channel, source_event_id)` | Повторная доставка того же outbox-события | `UNIQUE`-конфликт, вторая запись НЕ создана, сообщение не продублировано пользователю |
| TC-ADM-023 | SRS-ADM-059 | `quiet_hours=22:00–08:00`, категория `'promotions'`, текущее время `23:00` | Диспетчеризация уведомления | Отправка отложена до `08:00` следующего дня |
| TC-ADM-024 | SRS-ADM-059 | Категория `'order_updates'` активного заказа, те же тихие часы | Диспетчеризация | Отправка НЕМЕДЛЕННО, тихие часы проигнорированы |
| TC-ADM-025 | SRS-ADM-060 | `SmsProvider` возвращает 5xx все 3 попытки, `web_push`/`in_app` доступны | Диспетчеризация события | `notifications(channel='sms').status='failed'`, но `web_push`/`in_app` доставлены успешно |
| TC-ADM-026 | SRS-ADM-054 | Событие из матрицы §6.1 не имеет шаблона на `locale='en'` | CI-тест полноты матрицы шаблонов | Тест падает ДО деплоя (не в рантайме) |
| TC-ADM-027 | SRS-ADM-064 | Роль приложения (`app_role`) | Прямой SQL `UPDATE audit_log SET reason=...` | Отклонено правами БД (`REVOKE UPDATE`), независимо от уровня приложения |
| TC-ADM-028 | SRS-ADM-065 | Актор — `pharmacy_admin` | `GET /audit-log` | `403 INSUFFICIENT_ROLE` на уровне guard'а, до входа в use case |
| TC-ADM-029 | SRS-ADM-069 | `analog_shown=100, analog_clicked=20, added_to_cart=15, order_placed=10` за период | `GET /analytics/funnel` | `conversionRates.overallShownToOrder = 0.10` |
| TC-ADM-030 | SRS-ADM-070 | 3 из 8 активных пилотных аптек прислали данные за 7 дней | `GET /platform-metrics` | `activePharmaciesSendingDataRate ≈ 0.375` — сигнал для kill-критерия #2 |
| TC-ADM-031 | SRS-ADM-073 | Период отчёта 45 дней | `GET .../export?format=csv` | `202 Accepted { exportJobId }`, НЕ синхронный поток |
| TC-ADM-032 | SRS-ADM-080 | Два `super_admin` одновременно вызывают `approve`/`reject` для одной заявки | Второй запрос долетает после первого | `409 ALREADY_REVIEWED`, только одна строка `onboarding_review_log` |
| TC-ADM-033 | SRS-ADM-082 | `catalog_match_queue` ссылается на уже смёрженный `medicineId=X→Y` | `resolve(action='match_existing', medicineId=X)` | `409 MEDICINE_ALREADY_MERGED { mergedInto: Y }` |
| TC-ADM-034 | SRS-ADM-086 | `license_expiry_date` уже в прошлом на момент решения | `POST .../approve` | `422 LICENSE_ALREADY_EXPIRED`, переход не выполнен |
| TC-ADM-035 | SRS-ADM-087 | OCR-джоба уже в очереди, флаг выключен ПОСЛЕ постановки | Флаг переключается `true→false` | Уже поставленная задача доводится до конца, флаг влияет только на НОВЫЕ постановки |
| TC-ADM-036 (негативный, e2e) | SRS-ADM-056, D-01 | `tenant.settings.brandName` изменён | Рендер ЛЮБОГО шаблона уведомления из матрицы §6.1 | Нигде не встречается старая захардкоженная строка бренда |
| TC-ADM-037 | SRS-ADM-036 | `platform_billing_invoices.due_at + grace_period` истёк, инвойс не оплачен | Джоба `InvoiceOverdueCheckJob` | `pharmacy_chains.is_active=false`, снятие доступно только через `lift-block` с `reason` |

---

**Итог**: документ вводит **89 требований `SRS-ADM-001..089`** (онбординг, модерация каталога,
админ-панель `super_admin`, кабинет `pharmacy_admin`, уведомления, `audit_log`, аналитика,
поддержка) и **9 новых элементов схемы БД** (`feature_flags`, `notification_templates`,
`notification_preferences`, `medicine_merge_log`, `product_events`, расширения `notifications`/
`pharmacies`/`pharmacy_verification`/`support_tickets`/`audit_action_category`/
`notification_channel`), каждый снабжён меткой релиза **R1/R2/R3** по `04-SCOPE-DECISION-PIVOT.md`.
Любое расхождение нижестоящих тикетов Tech Lead с этим документом разрешается ТОЛЬКО через ADR.
