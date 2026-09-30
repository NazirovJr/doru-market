# Research 08 (Gap-2) — Dispute & Customer Support Resolution Workflow

> Область: сквозной процесс обращений в поддержку и споров по заказу — каналы приёма, модель
> данных тикетов/споров, конечный автомат статусов, требования к доказательствам, матрица
> полномочий на резолюцию, SLA, и точная механика взаимодействия со `escrow_ledger` /
> `payout_schedule`. Источник входных требований: Charter §3 (`user_role`, Provider Pattern,
> RBAC), Charter §5 (audit, RBAC guard), `research/03-payments-and-escrow.md` §6.2/§6.3 и
> REQ-PAY-1, REQ-PAY-6, REQ-PAY-9, REQ-PAY-11 (там впервые упомянуты `dispute_window_days`,
> блокировка payout активным спором и `admin_payment_override`, но без модели данных),
> `research/02-regulatory-and-compliance.md` §7 (ст.18/ст.22-23/ст.25 Закона РТ «О защите прав
> потребителей», REQ-REG-15), tz.log Модуль 5 (SLA сборки 7 минут, OTP), Charter §3.4
> (White-Label: деньги сети идут напрямую на её мерчант-счёт).
>
> Методология: как и в предыдущих research-документах, всё не подтверждённое первоисточником
> помечено **ASSUMPTION** (обоснованное предположение по аналогии с рынком) или **UNVERIFIED**
> (не найдено вообще). Полный текст закона РТ «О защите прав потребителей» не найден в открытом
> доступе (платный доступ на `base.spinform.ru`) — это уже задокументировано в `02`, здесь этот
> факт наследуется, а не переоткрывается.

---

## 1. Что уже задано и что достраивается

Уже зафиксировано в `03-payments-and-escrow.md`:
- §6.3: `dispute_window_days` (ASSUMPTION, ориентир 24 часа после `delivered`) — окно, в течение
  которого клиент может открыть спор через поддержку и заморозить `payout_schedule.status`.
- REQ-PAY-6: выплата аптеке блокируется, если по заказу открыт активный спор.
- REQ-PAY-1: любое ручное вмешательство в статус оплаты — только через `admin_payment_override`
  (роль `super_admin`, обязательный `reason`, запись в audit log).
- §6.2 `escrow_ledger.entry_type` уже включает `adjustment` — «ручная корректировка (только
  super_admin, с обоснованием)» — заранее зарезервированный крючок именно для случаев вроде спора.

Отсутствует (закрывается этим документом): кто и как открывает тикет/спор, модель данных
(`support_tickets`, `order_disputes`), состояния и переходы, требования к доказательствам, кто
имеет право какое решение принять, целевые SLA, и — центральный вопрос задания — **точное условие**,
при котором `payout_schedule.status` возвращается в состояние, допускающее выплату.

---

## 2. Два объекта, а не один: `support_tickets` vs `order_disputes`

Разделение обосновано тем, что не любое обращение в поддержку связано с деньгами (не любое должно
блокировать payout), а любой спор, блокирующий payout, обязан иметь строгий, отдельно
аудируемый жизненный цикл, отличный от произвольной переписки.

- **`support_tickets`** — общий helpdesk: любые обращения (в т.ч. не про деньги — вопрос по
  рецепту, жалоба на курьера без денежного требования, технический баг). Аналог модели
  Zendesk: тикет проходит через `new → open → pending_customer/pending_pharmacy → resolved →
  closed`, где `pending_*` означает «мяч на другой стороне», а `closed` — финальное состояние,
  автоматически наступающее через N дней после `resolved`, без возможности повторного открытия
  (переоткрытие создаёт новый тикет со ссылкой на предыдущий) [1].
- **`order_disputes`** — специализированная сущность **только** для случаев, где на кону деньги
  конкретного заказа (весь список категорий — §4). Один `support_ticket` категории, помеченной
  `is_escrow_blocking = true`, порождает ровно одну связанную запись `order_disputes`. Именно
  `order_disputes.status` (не статус тикета) читает payout-джоб.

Референс по терминологии стадий «спор → эскалация → окончательное решение»: платёжная индустрия
уже решает почти идентичную задачу для чарджбэков — Stripe разделяет `needs_response` (мяч на
продавце) → `under_review` (мяч на банке/арбитре) → терминальные `won`/`lost` [2][3]. Мы
переиспользуем эту же трёхчастную форму (открыт → на рассмотрении → решён) для `order_disputes`,
адаптированную под то, что арбитр здесь — не банк, а саппорт/супер-админ DoruTJ.

---

## 3. Каналы приёма и кто может открыть

| Канал | Кто инициирует | Механика |
|---|---|---|
| **In-app (основной)** | `customer` | Кнопка «Сообщить о проблеме» на экране заказа, доступна начиная со статуса `picked_up` (проблемы с курьером) и обязательно доступна после `delivered` (весь §4). Обязательный выбор категории из `ticket_category` (сервер отдаёт список через `GET /api/v1/meta`, Charter §3.6.5 — категории не хардкодятся в клиенте). |
| **Telegram-бот (вторичный, диспетчер, не отдельная система)** | `customer` | Бот уже является основным каналом статусных уведомлений с сохранённым `chat_id` (`research/07`, REQ-NOTIF-2). Под уведомлением о `delivered` — inline-кнопка «Сообщить о проблеме», которая делает **deep-link в TWA** на экран создания тикета, а не собирает свободный текст в самом чате бота. Причина: Charter §3.6.1 запрещает бизнес-логику в клиенте и требует единственный контракт REST/JSON — свободный текст в Telegram нельзя валидировать по `ticket_category`/`order_id`, и он не даёт структурированной вложенной evidence. Бот остаётся диспетчером, а не параллельным источником истины. |
| **Телефон (call-center)** | `customer` (по телефону) → тикет заводит `support_agent` | Агент создаёт тикет вручную в admin-панели с `channel = 'phone'`, находит клиента по номеру телефона/`customer_id`; правила категорий/evidence идентичны in-app каналу — единый источник истины сохраняется. |
| **Аптека (`pharmacy_admin`/`pharmacist`)** | `pharmacy_admin`, `pharmacist` | Ограниченный набор категорий: `fraud_suspected_customer`, `payment_issue` (repost несовпадения по 1С), `technical_sync_issue`. **Аптека не может открыть или разрешить спор в категориях, где выгодоприобретатель — она сама** (см. §6, конфликт интересов) — максимум флаг/сигнал для саппорта. |
| **Курьер** | нет прямого создания тикета | Исключения доставки (delivery_sla истёк, клиент недоступен) уже порождают эскалацию оператору по логике `03-payments-and-escrow.md` §6.3 — это событие **автоматически** создаёт `support_tickets` с `channel = 'system_auto'`, `category = 'order_not_received'`, `opened_by_role = 'courier'` от имени системы. |
| **Система (авто)** | `system` | Реконсиляция (`REQ-PAY-9`, `reconciliation_discrepancies`) при обнаружении расхождения по конкретному заказу автоматически заводит `support_tickets(category='payment_issue', channel='system_auto')` — гарантирует, что найденное расхождение не потеряется без владельца-человека. |

Явное правило разделения ответственности (снижает риск self-dealing): **только `customer` и
система** могут инициировать `order_disputes`, которые блокируют деньги в пользу клиента;
`pharmacy_admin`/`pharmacist` могут только сигнализировать через обычный `support_ticket`,
который сотрудник поддержки (не аптека) при необходимости эскалирует в `order_disputes`.

---

## 4. Категории тикетов и признак `is_escrow_blocking`

```
ticket_category                       is_escrow_blocking   Типовое действие
────────────────────────────────────  ───────────────────  ───────────────────────────
order_not_received                    true                 refund_full
order_item_missing_or_wrong           true                 refund_partial | refund_full
order_item_damaged_or_expired         true                 refund_full | replacement
order_quality_defect                  true                 replacement | refund_full (+ регуляторный флаг)
payment_issue                         true                 refund через adjustment (см. §7)
prescription_rejected_appeal          false                нет денежного действия
courier_behavior                      false*                нет денежного действия (см. ниже)
account_technical                     false                нет денежного действия
other                                 false                классифицируется агентом вручную
```
`*courier_behavior` не блокирует payout по умолчанию, но если жалоба фактически про недоставку —
агент обязан **переклассифицировать** её в `order_not_received` при принятии в работу (первое
действие агента — подтвердить/скорректировать категорию, ровно как в практике Ozon, где категория
и подкатегория обращения — обязательные поля жалобы [4]).

Юридическая привязка (`02-regulatory-and-compliance.md`, ст.18/ст.25 Закона РТ «О защите прав
потребителей», REQ-REG-15): `order_item_damaged_or_expired` и `order_quality_defect` — это всегда
брак/недостаток (ст.18), право на полный возврат/замену **не может быть отклонено** по причине
«хочет просто вернуть медикамент» — категория «обмен товара надлежащего качества просто так»
(ст.25) для `medicines` в каталоге не существует вовсе (UI не предлагает такую опцию — уже
зафиксировано в REQ-REG-15). Иными словами: `order_disputes.resolution_action = 'deny'` для
категории `order_item_damaged_or_expired`/`order_quality_defect` допустим **только** если evidence
объективно опровергает брак (см. §5), а не потому что «медикаменты возврату не подлежат» — это
относится к другому основанию отказа (ст.25) и здесь неприменимо.

---

## 5. Обязательные доказательства (evidence) по категориям

| Категория | Обязательная evidence | Автоматически прикладывается системой |
|---|---|---|
| `order_not_received` | нет обязательного фото от клиента | `order_items` snapshot, таймстемп курьерского OTP-подтверждения (`delivered_at`), геометка курьера на момент `delivered` (если есть) |
| `order_item_missing_or_wrong` | ≥1 фото полученных товаров/упаковки | `order_items` snapshot (что должно было быть), фото штрихкода, отсканированного фармацевтом при сборке (терминал фармацевта, tz.log Модуль 5) — для сверки, что отгружен правильный товар |
| `order_item_damaged_or_expired` | ≥1 фото товара **и** ≥1 фото упаковки/этикетки с датой срока годности | `batch_number`/`expiry_date` из `pharmacy_inventory` на момент продажи (для сверки — не подменили ли партию) |
| `order_quality_defect` | описание симптома/реакции (текст обязателен), фото упаковки желательно | `medicine_id`, `inn_name`, `manufacturer_name` — для последующей маршрутизации в фармаконадзор (см. Открытые вопросы) |
| `payment_issue` | скриншот банковского SMS/списания — **необязателен**, только вспомогателен | `escrow_ledger` записи по `order_id`, результат `getBillStatus` (сверка с REQ-PAY-9) |

Общие правила:
- Хранилище evidence — `ObjectStorageProvider` (Charter §3.3, тот же интерфейс, что и
  `prescription_image_url`), не новая инфраструктура.
- Формат/лимиты — переиспользовать уже принятые для рецептов ограничения (image/jpeg|png,
  предполагаемый потолок размера файла — **ASSUMPTION**, требует утверждения вместе с лимитами
  OCR-пайплайна из `research/05`).
- Отсутствие обязательной evidence **не блокирует** создание тикета (клиент может не суметь
  сфотографировать сразу), но переводит `order_disputes.status` в `awaiting_customer` с явным
  запросом от агента и остановкой SLA-таймера резолюции на это время (по аналогии с `pending`
  в Zendesk, где SLA-таймер стандартно приостанавливается, пока мяч на стороне клиента [1]).

---

## 6. Матрица полномочий на резолюцию

| Категория / условие | `support_agent` может | Только `super_admin` |
|---|---|---|
| `order_not_received`, полный возврат ≤ `dispute_auto_refund_threshold_dirams` (per-tenant, ASSUMPTION по умолчанию 15 000 дирам = 150 TJS — требует утверждения финансами) | ✅ `refund_full` через стандартный `PaymentProvider.refund()` | — |
| Тот же случай, сумма > порога | — | ✅ (тот же `refund_full`, но с обязательным вторым подтверждением) |
| `order_item_missing_or_wrong` — частичный возврат (пересчёт по позициям) | — | ✅ (частичный возврат всегда требует ручного пересчёта суммы → всегда `super_admin`, см. §7) |
| `order_item_damaged_or_expired` с фото-evidence, полный возврат/замена | ✅ | — |
| `order_quality_defect` (жалоба на реакцию/качество) | ❌ (только присвоение/эскалация) | ✅ (плюс регуляторный флаг, §Открытые вопросы) |
| `payment_issue` (двойное списание, расхождение реконсиляции) | ❌ | ✅ **обязательно** через `escrow_ledger.entry_type = 'adjustment'` (см. §7) |
| Заказ уже в статусе `captured_to_pharmacy` (payout уже выполнен) | ❌ | ✅ (clawback/adjustment — см. §7.4) |
| Заказ тенанта White-Label (`pharmacy_chains.is_whitelabel_active = true`) | ✅ фиксирует решение | ✅ обязана дать финальное execution-подтверждение (см. §7.5) |
| Любое действие, требующее `admin_payment_override` (искусственное моделирование прихода вебхука, а не обычный `refund()`) | ❌ | ✅ (REQ-PAY-1, без исключений) |

Обоснование разделения «стандартный refund vs `adjustment`/`admin_payment_override`»:
`PaymentProvider.refund()` — штатный, уже специфицированный, идемпотентный метод интерфейса
(REQ-PAY-8), доступный из бизнес-логики резолюции спора без необходимости имитировать
что-либо. `admin_payment_override`/`escrow_ledger.entry_type = 'adjustment'` — крайняя мера для
случаев, когда штатного пути физически не существует (провайдер не вернул деньги и не даёт
причину — REQ-PAY-11 — либо деньги уже выплачены аптеке и путь возврата — не рефанд, а
внутренняя корректировка баланса). Смешивать эти два механизма запрещено: `support_agent` никогда
не имеет доступа ко второму.

---

## 7. Точный механизм: как резолюция спора меняет `escrow_ledger` / `payout_schedule`

### 7.1 Расширение схемы `payout_schedule` (поверх `03-payments-and-escrow.md` §6.2)

```sql
ALTER TABLE payout_schedule
  ADD COLUMN held_by_dispute_id UUID REFERENCES order_disputes(id);
-- status по-прежнему VARCHAR(20), добавляется допустимое значение 'disputed' в чек-констрейнт:
-- pending | due | disputed | paid | failed | reversed
```

### 7.2 Постановка на паузу (открытие спора)

Триггер (в той же транзакции, где создаётся `order_disputes` со статусом `open`):
```
UPDATE payout_schedule
SET status = 'disputed', held_by_dispute_id = :dispute_id, updated_at = now()
WHERE order_id = :order_id AND status IN ('pending', 'due');
```
Payout-джоб (`worker`, BullMQ) в своём `WHERE`-условии уже обязан фильтровать `status IN
('pending','due')` — `disputed` физически исключён из выборки без дополнительных `IF` в коде джобы
(меньше риска забыть проверку в новом месте).

### 7.3 Снятие паузы — три ветки резолюции

**Ветка A — `resolved_reject` (спор отклонён, аптека не виновата).**
Условие снятия: `order_disputes.status = 'resolved_reject' AND resolution_reason IS NOT NULL AND
resolved_by_user_id IS NOT NULL`.
```
UPDATE payout_schedule
SET status = CASE WHEN due_at <= now() THEN 'due' ELSE 'pending' END,
    held_by_dispute_id = NULL
WHERE held_by_dispute_id = :dispute_id;
```
Именно эта ветка — то самое «возвращает `payout_schedule.status` в `due`», упомянутое в задании:
условие — терминальный статус `resolved_reject` **и** заполненный `resolution_reason` (audit),
никогда не по факту простого истечения времени.

**Ветка B — `resolved_refund_full` (клиент прав, полный возврат).**
1. `PaymentProvider.refund()` на полную сумму → `escrow_ledger` пишет `refunded_to_customer`,
   `idempotency_key = order_id || ':dispute:' || dispute_id`.
2. `payout_schedule.status = 'reversed'`, `amount_dirams = 0`, `held_by_dispute_id = NULL`.
   Аптека не получает выплату по этому заказу.

**Ветка C — `resolved_refund_partial` (частичный возврат).**
1. `escrow_ledger` пишет `partially_refunded` на сумму `resolution_amount_dirams`.
2. ```
   UPDATE payout_schedule
   SET amount_dirams = amount_dirams - :resolution_amount_dirams,
       status = CASE WHEN due_at <= now() THEN 'due' ELSE 'pending' END,
       held_by_dispute_id = NULL
   WHERE held_by_dispute_id = :dispute_id;
   ```
   Аптека получает остаток после вычета возвращённой клиенту суммы — деньги за забракованный
   товар не платятся аптеке, но заказ в остальном закрывается штатно.

**Ветка `resolved_replacement`** не трогает `escrow_ledger`/`payout_schedule` исходного заказа
вовсе (просто снимает `disputed` → `due`/`pending` как в ветке A) — замена оформляется отдельным
новым `order_id` (новый заказ, новый цикл escrow), чтобы не переиспользовать ledger одного заказа
для двух физических отгрузок.

### 7.4 Edge case — спор открыт после того, как `captured_to_pharmacy` уже выполнен

Если `payout_schedule.status` уже `'paid'` (payout-джоб выполнил перевод раньше, чем клиент успел
открыть спор — например, `dispute_window_days` истёк, но клиент обнаружил брак позже), снять
паузу с уже выполненного payout нельзя — денег в `payout_schedule` для отмены нет. Решение:
1. `order_disputes` всё равно заводится и рассматривается (юридическое право на возврат брака по
   ст.18 не имеет короткого «окна» в отличие от операционного `dispute_window_days`).
2. Резолюция `resolved_refund_full`/`partial` для этого случая обязана идти через
   `escrow_ledger.entry_type = 'adjustment'` (**только `super_admin`**, `reason` обязателен) —
   деньги клиенту возвращаются из операционного счёта DoruTJ немедленно, а списание с аптеки
   оформляется как отрицательная запись, засчитываемая в **следующий** цикл `payout_schedule`
   этой аптеки (netting), а не как физический истребование денег обратно у аптеки. Это прямое
   расширение уже принятого паттерна реконсиляции (§6.6/REQ-PAY-9 в `research/03`) — там
   расхождения тоже уходят в ручной разбор, а не в автоматическую отмену.
3. Помечается как **ASSUMPTION**, требующее подтверждения финансовой моделью: механизм
   «отрицательного баланса аптеки, засчитываемого в следующую выплату» **не описан** ни в одном
   из уже принятых документов — это открытый вопрос §12.

### 7.5 Edge case — тенант White-Label

Для тенантов с `is_whitelabel_active = true` деньги идут напрямую на мерчант-счёт сети (Charter
§3.4, REQ-PAY-6), `payout_schedule` для них — уведомление, а не реальный перевод. DoruTJ **не
может** технически выполнить `refund()` от имени сети. Поэтому:
- `order_disputes.resolution_action` фиксируется как обычно (единый источник решения для
  клиента), но добавляется поле `requires_tenant_execution BOOLEAN` = true для WL-заказов.
- Статус `closed` для такого спора недостижим, пока `pharmacy_admin` сети не подтвердит через
  отдельный чекбокс/эндпоинт `POST /disputes/:id/confirm-tenant-refund`, что возврат выполнен на
  их стороне (их банк, их ответственность) — это фиксируется в `dispute_status_history` отдельной
  записью с `changed_by_role = 'pharmacy_admin'`.
- До этого подтверждения спор висит в `awaiting_pharmacy`, что видно в очереди саппорта DoruTJ
  как отдельный SLA-класс (эскалация уже не к DoruTJ, а к сети — коммерческий, не технический,
  вопрос по SLA этой сети в White-Label контракте — открытый вопрос §12).

---

## 8. Конечный автомат `order_disputes.status`

```
                                   ┌───────────────────────────────────┐
                                   │   (открытие тикета is_escrow_     │
                                   │    blocking=true → авто-создание) │
                                   └─────────────────┬───────────────────┘
                                                     ▼
                                              ┌─────────────┐
                              ┌───────────────│    open     │◄──────────────┐
                              │               └──────┬──────┘               │
                    evidence запрошена,              │ агент взял в работу  │ клиент донёс evidence
                    таймер резолюции на паузе         │ (assigned_to_user_id)│ / ответил на вопрос
                              │                       ▼                      │
                              │               ┌───────────────┐              │
                              └──────────────► │ under_review  │──────────────┘
                                              └───┬───────┬───┘
                          нужно уточнение у аптеки│       │нужно уточнение у клиента
                                              ▼             ▼
                                   ┌───────────────┐  ┌──────────────────┐
                                   │awaiting_pharmacy│  │ awaiting_customer│
                                   └────────┬────────┘  └────────┬─────────┘
                                            └──────────┬──────────┘
                                                       ▼
                                              ┌───────────────┐
                                    ┌─────────┤  under_review │─────────┐
                                    │         └───────────────┘         │
                     support_agent/super_admin решает                    │только super_admin
                                    ▼                                    ▼
                    ┌───────────────────────────┐          ┌─────────────────────────┐
                    │  resolved_reject           │          │ resolved_refund_full /  │
                    │  (payout → due/pending)     │          │ resolved_refund_partial /│
                    └──────────────┬─────────────┘          │ resolved_replacement     │
                                   │                        └────────────┬─────────────┘
                                   └───────────────┬────────────────────┘
                                                   ▼
                                            ┌─────────────┐
                                            │   closed    │  (WL-заказ: сначала awaiting_pharmacy
                                            └─────────────┘   confirm-tenant-refund, см. §7.5)
```

Правила переходов:
- Из `open`/`under_review`/`awaiting_*` возможен единственный «побочный» переход — клиент/аптека
  отвечают, возвращая в `under_review`; никакого прямого перехода `open → resolved_*` в обход
  `under_review` (не должно быть «мгновенного» решения без хотя бы одной итерации рассмотрения —
  инвариант, тестируемый на уровне БД/сервиса).
- `resolved_reject → closed` и `resolved_refund_* → closed` — автоматически, кроме WL-кейса §7.5.
- `closed` не переоткрывается: повторное обращение клиента по тому же `order_id` создаёт **новый**
  `support_ticket`/`order_disputes` со ссылкой `related_dispute_id` на предыдущий (тот же принцип,
  что и в Zendesk — `closed` не модифицируется [1]).
- Максимум один нетерминальный (`open`/`under_review`/`awaiting_*`) спор на `order_id`
  одновременно — обеспечивается частичным уникальным индексом:
  ```sql
  CREATE UNIQUE INDEX one_active_dispute_per_order ON order_disputes (order_id)
  WHERE status NOT IN ('resolved_reject','resolved_refund_full','resolved_refund_partial',
                        'resolved_replacement','closed');
  ```

---

## 9. Минимальная схема (сводно)

```sql
CREATE TYPE ticket_channel AS ENUM ('in_app', 'telegram_bot', 'phone', 'system_auto');

CREATE TYPE ticket_category AS ENUM (
  'order_not_received', 'order_item_missing_or_wrong', 'order_item_damaged_or_expired',
  'order_quality_defect', 'payment_issue', 'prescription_rejected_appeal',
  'courier_behavior', 'account_technical', 'other'
);

CREATE TYPE ticket_status AS ENUM (
  'new', 'open', 'pending_customer', 'pending_pharmacy', 'resolved', 'closed'
);

CREATE TABLE support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES pharmacy_chains(id),        -- NULL = нейтральный DoruTJ
    order_id UUID REFERENCES orders(id),
    customer_id UUID,
    opened_by_user_id UUID NOT NULL,
    opened_by_role user_role NOT NULL,
    channel ticket_channel NOT NULL,
    category ticket_category NOT NULL,
    is_escrow_blocking BOOLEAN NOT NULL DEFAULT false,
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    status ticket_status NOT NULL DEFAULT 'new',
    assigned_to_user_id UUID,
    first_response_due_at TIMESTAMPTZ NOT NULL,
    first_responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_user_id UUID NOT NULL,
    author_role user_role NOT NULL,
    body TEXT NOT NULL,
    is_internal_note BOOLEAN NOT NULL DEFAULT false,      -- заметка агента, скрыта от клиента
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ticket_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    uploaded_by_user_id UUID NOT NULL,
    file_url TEXT NOT NULL,           -- ObjectStorageProvider, Charter §3.3
    mime_type VARCHAR(100) NOT NULL,
    evidence_type VARCHAR(30) NOT NULL, -- 'photo_item' | 'photo_packaging' | 'photo_receipt' | 'other'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE dispute_status AS ENUM (
  'open', 'under_review', 'awaiting_customer', 'awaiting_pharmacy',
  'resolved_reject', 'resolved_refund_full', 'resolved_refund_partial',
  'resolved_replacement', 'closed'
);

CREATE TYPE dispute_resolution_action AS ENUM (
  'refund_full', 'refund_partial', 'replacement', 'deny'
);

CREATE TABLE order_disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(id),
    order_id UUID NOT NULL REFERENCES orders(id),
    opened_by_user_id UUID NOT NULL,
    opened_by_role user_role NOT NULL,
    status dispute_status NOT NULL DEFAULT 'open',
    resolution_action dispute_resolution_action,
    resolution_amount_dirams BIGINT,          -- только для refund_partial
    resolution_reason TEXT,                   -- обязателен для любого resolved_*
    resolved_by_user_id UUID,
    resolved_by_role user_role,
    requires_tenant_execution BOOLEAN NOT NULL DEFAULT false,  -- White-Label, см. §7.5
    related_dispute_id UUID REFERENCES order_disputes(id),     -- если это повтор после closed
    first_response_due_at TIMESTAMPTZ NOT NULL,
    resolution_due_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dispute_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id UUID NOT NULL REFERENCES order_disputes(id) ON DELETE CASCADE,
    from_status dispute_status,
    to_status dispute_status NOT NULL,
    changed_by_user_id UUID NOT NULL,
    changed_by_role user_role NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Расширение уже существующей схемы (research/03 §6.2):
ALTER TABLE payout_schedule ADD COLUMN held_by_dispute_id UUID REFERENCES order_disputes(id);
-- допустимые payout_schedule.status теперь: pending | due | disputed | paid | failed | reversed

-- Расширение user_role (Charter §5 разрешает расширения ENUM при сохранении исходных имён):
ALTER TYPE user_role ADD VALUE 'support_agent';
```

`support_agent` — новая роль, отсутствовавшая в исходном `user_role` из tz.log/Charter §3 (там
только `customer, pharmacist, courier, pharmacy_admin, super_admin`). Обоснование расширения:
без выделенной роли обработка тикетов легла бы либо на `pharmacy_admin` (конфликт интересов —
§3, §6), либо потребовала бы, чтобы каждый агент поддержки имел полный `super_admin` (нарушение
принципа наименьших привилегий — агент не должен иметь доступ к `admin_payment_override` и
White-Label конфигуратору). Charter §5 прямо разрешает расширения схемы при условии сохранения
исходных имён — новая роль не удаляет и не переименовывает ничего из tz.log.

---

## 10. SLA — целевые показатели

| Метрика | Целевое значение (default) | Обоснование |
|---|---|---|
| `first_response_due_at` (обычный тикет, `support_tickets`) | `created_at + 24 часа` | Отраслевой ориентир техподдержки e-commerce (общая практика приоритезации SLA — urgent/high быстрее, здесь взят консервативный верхний предел для любой категории) — **ASSUMPTION**, конкретное число требует утверждения продуктом. |
| `resolution_due_at` — простые категории (`order_not_received`, `order_item_missing_or_wrong`) | `created_at + 72 часа` (3 календарных дня) | По аналогии с практикой Ozon: заявленный срок рассмотрения спора «в течение 3 календарных дней» с решением на основе приложенных доказательств [4] — **ASSUMPTION по аналогии**, не факт из практики DoruTJ. |
| `resolution_due_at` — `order_item_damaged_or_expired`, `order_quality_defect` | `created_at + 10 календарных дней` | По аналогии с практикой Wildberries/типовой нормой законодательства о защите прав потребителей в СНГ (в РФ — 10 дней на удовлетворение денежного требования потребителя по дефектному товару) [5][6] — то же логическое допущение уже применено в `research/02` для ст.22-23 закона РТ (полный текст статьи не найден, но структура нормы типична для СНГ) — **ASSUMPTION**. |
| `resolution_due_at` — `payment_issue` | `created_at + 5 рабочих дней` | Требует сверки с банком (реконсиляция, REQ-PAY-9 — ежедневная джоба), решение агента не может быть быстрее, чем цикл сверки — **ASSUMPTION**. |
| Автоэскалация при просрочке | Если `now() > resolution_due_at` и статус не терминален → автоматическая эскалация `assigned_to_user_id = null`, приоритет `urgent`, уведомление `super_admin` | Предотвращает «зависшие» споры, которые вечно блокируют payout аптеке — иначе недобросовестный клиент мог бы держать аптеку без денег бесконечно. |
| Заморозка SLA-таймера | Пока `status IN ('awaiting_customer')` — таймер резолюции не тикает | Иначе агент наказывается SLA за то, что ждёт данные от клиента — практика, аналогичная `pending` в Zendesk, которая по умолчанию приостанавливает SLA [1]. |

---

## 11. Admin UI (admin, `apps/admin`) — минимальный набор экранов

1. **Очередь тикетов**: фильтры по `status`, `category`, `channel`, `tenant_id`,
   `is_escrow_blocking`; сортировка по `first_response_due_at`/`resolution_due_at` с визуальным
   бейджем просрочки (красный, если `now() > due_at`).
2. **Карточка тикета/спора**: таймлайн сообщений (`ticket_messages`, включая internal notes),
   галерея `ticket_evidence`, снапшот заказа (`order_items`, `escrow_ledger` по `order_id`),
   кнопки действия — набор зависит от роли согласно матрице §6 (кнопка `refund_partial`
   физически не рендерится для `support_agent`, а не просто задизейблена — минимизирует
   поверхность атаки).
3. **Форма резолюции**: обязательное поле `resolution_reason` (свободный текст) при любом
   терминальном статусе — без заполнения кнопка «Подтвердить» неактивна (клиентская валидация +
   серверная проверка `NOT NULL`).
4. **Вкладка Audit**: полный `dispute_status_history` по спору — кто, когда, что изменил и
   почему; для WL-заказов — отдельная строка подтверждения `pharmacy_admin` (§7.5).
5. **Дашборд SLA**: агрегированные метрики (среднее время первого ответа/резолюции, доля
   просроченных, разбивка по `tenant_id`) — нужен для последующего пересмотра ASSUMPTION-порогов
   §10 на реальных данных после запуска.

---

## Требования, вытекающие из исследования

1. **REQ-DISPUTE-1**: Система обязана хранить обращения в поддержку в единой таблице
   `support_tickets` независимо от канала (`in_app`, `telegram_bot`, `phone`, `system_auto`);
   свободный текст, принятый по телефону или в Telegram, обязан транскрибироваться в структурную
   запись с обязательными полями `category`/`order_id` (если применимо) — не может существовать
   обращение, видимое только в Telegram-переписке без соответствующей записи в БД.
2. **REQ-DISPUTE-2**: Каждый `support_ticket` с `category`, для которой `is_escrow_blocking =
   true` (§4), обязан при создании атомарно (в одной транзакции) породить ровно одну связанную
   запись `order_disputes` со статусом `open`.
3. **REQ-DISPUTE-3**: На один `order_id` не может существовать более одного нетерминального
   (`status NOT IN (resolved_*, closed)`) `order_disputes` одновременно — обеспечивается частичным
   уникальным индексом на уровне БД, а не только проверкой в коде приложения.
4. **REQ-DISPUTE-4**: Открытие `order_disputes` для заказа с `payout_schedule.status IN
   ('pending','due')` обязано в той же транзакции перевести `payout_schedule.status = 'disputed'`
   и записать `held_by_dispute_id`; payout-джоб обязан исключать `status = 'disputed'` из выборки
   на подготовку выплат без дополнительной ветвящейся логики.
5. **REQ-DISPUTE-5**: Переход `order_disputes.status` в `resolved_reject` обязан быть
   единственным условием (наряду с заполненным `resolution_reason` и `resolved_by_user_id`),
   возвращающим `payout_schedule.status` в `due` (если `due_at <= now()`) либо `pending` (если
   `due_at` ещё не наступил), и обнуляющим `held_by_dispute_id`; истечение времени само по себе
   не является основанием для снятия блокировки.
6. **REQ-DISPUTE-6**: Переход в `resolved_refund_full` обязан вызвать `PaymentProvider.refund()`
   на полную сумму, записать `escrow_ledger.entry_type = 'refunded_to_customer'` и перевести
   `payout_schedule.status = 'reversed'`, `amount_dirams = 0` — аптека не получает выплату по
   этому заказу.
7. **REQ-DISPUTE-7**: Переход в `resolved_refund_partial` обязан записать
   `escrow_ledger.entry_type = 'partially_refunded'` на `resolution_amount_dirams`, уменьшить
   `payout_schedule.amount_dirams` на ту же сумму и затем применить то же условие снятия паузы,
   что и REQ-DISPUTE-5 (по оставшейся сумме).
8. **REQ-DISPUTE-8**: Если `order_disputes` открывается по заказу, у которого
   `payout_schedule.status = 'paid'` (payout уже выполнен), система не пытается физически
   отменить уже выполненный перевод; резолюция в пользу клиента обязана идти исключительно через
   `escrow_ledger.entry_type = 'adjustment'` с ролью `super_admin` и обязательным `reason`
   (расширение существующего REQ-PAY-1/§6.2), а не через обычный `refund()`.
9. **REQ-DISPUTE-9**: Действие `refund_partial` и любое действие через
   `escrow_ledger.entry_type = 'adjustment'` доступны исключительно роли `super_admin`;
   `support_agent` физически не имеет в UI/API элемента управления для этих действий (не только
   не показывается в интерфейсе, но и отклоняется RBAC guard'ом на уровне API, даже при прямом
   вызове эндпоинта).
10. **REQ-DISPUTE-10**: Роли `pharmacy_admin` и `pharmacist` не могут открыть или разрешить
    `order_disputes` в статусах, дающих в их пользу отказ клиенту (`resolved_reject`) по заказам
    своей же аптеки/сети — они могут только создать обычный `support_ticket` (сигнал), решение
    принимает исключительно `support_agent`/`super_admin`.
11. **REQ-DISPUTE-11**: Для заказов тенанта с `pharmacy_chains.is_whitelabel_active = true`
    `order_disputes` не может перейти в терминальный `closed`, пока `requires_tenant_execution =
    true` и не получено отдельное подтверждение от `pharmacy_admin` соответствующей сети через
    выделенный эндпоинт (`confirm-tenant-refund`), фиксируемое в `dispute_status_history`.
12. **REQ-DISPUTE-12**: Для категорий `order_item_damaged_or_expired` и `order_quality_defect`
    отказ (`resolved_reject`) допустим только если `resolution_reason` содержит конкретное
    опровержение предоставленной evidence (не может быть автоматически отклонён по общей
    формулировке «медикаменты возврату не подлежат» — это основание ст.25 закона РТ и к дефекту
    по ст.18 неприменимо, см. `REQ-REG-15`).
13. **REQ-DISPUTE-13**: Каждый терминальный статус (`resolved_*`) обязан иметь непустой
    `resolution_reason`, заполненный `resolved_by_user_id`/`resolved_by_role`, и полную запись в
    `dispute_status_history` — отсутствие любого из полей блокирует сохранение записи на уровне
    БД (`NOT NULL`/constraint), а не только на уровне формы.
14. **REQ-DISPUTE-14**: `first_response_due_at`/`resolution_due_at` вычисляются при создании
    тикета/спора по конфигурируемым per-tenant таймаутам (§10); при просрочке (`now() >
    resolution_due_at` и статус нетерминален) фоновый job обязан автоматически повысить приоритет
    и уведомить `super_admin` — просроченный спор не должен оставаться назначенным только на
    исходного агента без эскалации.
15. **REQ-DISPUTE-15**: Пока `order_disputes.status = 'awaiting_customer'`, отсчёт
    `resolution_due_at` приостанавливается (таймер не тикает против агента, пока мяч на стороне
    клиента) и возобновляется при получении ответа/evidence от клиента.
16. **REQ-DISPUTE-16**: SLA-исключение по срокам сборки/доставки, зафиксированное в
    `research/03-payments-and-escrow.md` §6.3 (просрочка `delivery_sla` → эскалация оператору),
    обязано автоматически создавать `support_tickets(channel='system_auto',
    category='order_not_received', opened_by_role='courier')`, а не оставаться необработанным
    внутренним алертом без объекта-владельца в очереди поддержки.
17. **REQ-DISPUTE-17**: Реконсиляционные расхождения (`reconciliation_discrepancies`, REQ-PAY-9)
    по конкретному `order_id` обязаны автоматически создавать `support_tickets(channel=
    'system_auto', category='payment_issue')`, чтобы расхождение не осталось только строкой в
    таблице без назначенного человека и SLA.
18. **REQ-DISPUTE-18**: Роль `support_agent` добавляется в `user_role` (расширение ENUM,
    исходные значения `customer, pharmacist, courier, pharmacy_admin, super_admin` не изменяются
    и не переименовываются — соответствует правилу Charter §5 о расширении схемы 1:1).
19. **REQ-DISPUTE-19**: Все denial-действия (`resolved_reject`) и любые действия
    `super_admin`-уровня обязаны логироваться структурно (pino, `requestId`, `tenantId`,
    `disputeId`, `orderId`) по тем же правилам, что и платёжные операции (REQ-PAY-13).
20. **REQ-DISPUTE-20**: Telegram-бот не хранит и не обрабатывает содержимое спора как
    самостоятельный источник истины — кнопка «Сообщить о проблеме» в боте обязана вести
    исключительно через deep-link в TWA/веб-форму создания `support_ticket`, соответствуя
    Charter §3.6.1 (ноль бизнес-логики в клиенте) и §3.6.4 (единый канал реалтайма/данных).

---

## Открытые вопросы

1. Точное значение `dispute_auto_refund_threshold_dirams` (порог, до которого `support_agent`
   может утвердить полный возврат без `super_admin`) не установлено ни в одном первоисточнике —
   предложено 150 TJS как ASSUMPTION, требует утверждения финансовой моделью/продуктом с учётом
   реального среднего чека заказа (данные по среднему чеку DoruTJ отсутствуют до запуска).
2. Механизм «отрицательного баланса аптеки, засчитываемого в следующий цикл `payout_schedule`»
   для edge case §7.4 (спор после уже выполненного payout) не описан ни в одном из принятых
   документов (`research/03` описывает только *обнаружение* расхождений, не *взыскание*) —
   требует отдельного финансового/юридического решения: вправе ли DoruTJ односторонне удерживать
   часть будущей выплаты аптеке по договору оферты/агентскому договору с сетью, или это требует
   явного пункта в договоре с каждой аптечной сетью.
3. Полный текст ст.22–23 Закона РТ «О защите прав потребителей» (точные сроки в днях на
   удовлетворение денежного требования потребителя) не найден в открытом доступе — доступ на
   `base.spinform.ru` платный, `ncz.tj` не отдаёт текст статьи напрямую. SLA-числа §10 приняты по
   аналогии с типовой нормой СНГ (10 дней) и практикой Wildberries/Ozon — требуется официальный
   текст закона РТ или консультация юриста заказчика перед утверждением как контрактного SLA (а
   не просто внутреннего таргета).
4. Не определено, требует ли категория `order_quality_defect` (жалоба на реакцию/качество
   лекарства) обязательного уведомления органа фармаконадзора РТ отдельно от денежной резолюции
   спора — `02-regulatory-and-compliance.md` не покрывает фармаконадзор/pharmacovigilance как
   тему; если требование существует, `order_disputes` для этой категории должен получить
   дополнительное поле `regulatory_notified_at`.
5. SLA для подтверждения `confirm-tenant-refund` со стороны White-Label сети (§7.5) не
   зафиксирован ни в одном документе — это коммерческий вопрос, который должен войти в типовой
   договор с сетью (Sifat/Oson/Madad), а не только в техническую спецификацию; открыт вопрос, что
   происходит, если сеть годами не подтверждает (нужен ли эскалационный путь до `super_admin`
   DoruTJ с ручным закрытием спора без подтверждения сети).
6. Не решено, должен ли `order_disputes` поддерживать эскалацию потребителя во внешнюю инстанцию
   (аналог российского Роспотребнадзора для РТ) как отдельный статус/поле, или это остаётся вне
   системы (клиент обращается в госорган самостоятельно, вне DoruTJ) — требует юридической
   консультации, аналогично открытому вопросу №1 в `research/02`.
7. Верхний лимит размера/формата файла для `ticket_evidence` не установлен — предложено
   переиспользовать лимиты, принятые для `prescription_image_url`/OCR-пайплайна (`research/05`),
   но эти лимиты сами по себе помечены как подлежащие утверждению в соответствующем документе.

---

## Источники

[1] Zendesk — About the ticket lifecycle and ticket statuses.
    https://support.zendesk.com/hc/en-us/articles/8263915942938-About-the-ticket-lifecycle-and-ticket-statuses

[2] Stripe — The Dispute object (статусы `needs_response`/`under_review`/`won`/`lost`).
    https://docs.stripe.com/api/disputes/object

[3] Chargebacks911 — Stripe Chargeback Timelines: How Long to Resolve Disputes?
    https://chargebacks911.com/chargeback-types/stripe-chargebacks/stripe-chargeback-timeline/

[4] Ozon — обращение в поддержку/претензионный процесс (категория/подкатегория обращения, фото/
    видео доказательства, рассмотрение специалистами в течение нескольких календарных дней).
    https://docs.ozon.ru/retail/settings/support/

[5] Pretenzia.com — досудебная претензия Wildberries (10-дневный срок удовлетворения денежного
    требования потребителя по дефектному товару, по аналогии с законодательством о защите прав
    потребителей).
    https://pretenzia.com/guide/other/kak-sostavit-dosudebnuyu-pretenziyu-na-wildberries

[6] Uzum Market — Инструкция для продавцов, раздел «Работа с площадкой» (сроки рассмотрения
    претензий/споров: 3 рабочих дня для отдельных категорий, 30 календарных дней — мотивированный
    отказ по акту расхождения).
    https://seller.uzum.uz/manual/7.work/

[7] Закон Республики Таджикистан «О защите прав потребителей» (оглавление, ст.18/22/23/25 —
    полный текст платный).
    https://base.spinform.ru/show_doc.fwx?rgn=8294

[8] DoruTJ — `docs/research/03-payments-and-escrow.md` (внутренний документ, §6.2/6.3, REQ-PAY-1,
    REQ-PAY-6, REQ-PAY-8, REQ-PAY-9, REQ-PAY-11).

[9] DoruTJ — `docs/research/02-regulatory-and-compliance.md` (внутренний документ, §7, REQ-REG-15).

[10] DoruTJ — `docs/research/07-telegram-pwa-and-delivery-ops.md` (внутренний документ, REQ-NOTIF-2
     — Telegram-бот как основной канал уведомлений).
