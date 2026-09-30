# Gap-1: Platform Monetization Model — Commission & White-Label Pricing

> Статус: **research draft**, закрывает пробел, обозначенный оркестратором после ревью
> `tz.log` + Charter + документов 01–07. Все числовые ставки, не подтверждённые первичным
> источником, помечены **ASSUMPTION** и требуют утверждения продуктом/финансами до того, как
> попадут в коммерческие договоры с аптеками/сетями.

## 0. Почему это отдельный документ, а не пункт в другом research-файле

`tz.log` описывает архитектуру Escrow (`03-payments-and-escrow.md`) и упоминает
`payout_schedule`/комиссию для `cash_courier` как «отдельный B2B биллинг» (см.
`03-payments-and-escrow.md` §6.5, REQ-PAY-6/REQ-PAY-14), но **нигде не называет число** —
ни процент, ни формулу, ни то, с какой базы (items_total vs total_amount) она считается.
Ни один из открытых источников (сайты Alif, DC Bank, публичные фарм-маркетплейсы) не публикует
коммерческие условия для площадок-агрегаторов — это подтверждённый вывод, а не пробел в поиске
(см. §1). Поэтому документ явно строит модель на основе сопоставимых рынков и фиксирует её как
**предлагаемое решение с явными ASSUMPTION**, а не как «найденный факт».

---

## 1. Что удалось подтвердить из первичных источников

### 1.1 Комиссии банковского эквайринга в Таджикистане (входят в себестоимость платежа, НЕ являются комиссией DoruTJ)

- **Alif** (`alif.tj/en/business/merchant-acquiring`) — публично не раскрывает процентные ставки
  эквайринга; страница рекламирует «Flexible commission setting system» и «receive money the next
  day after payment», без цифр. Ставки — по запросу через отдел партнёрств
  ([alif.tj/en/business/merchant-acquiring](https://alif.tj/en/business/merchant-acquiring)).
- **Dushanbe City Bank (DC Bank / DC Next)** (`dc.tj/bussiness/Acquiring`) — публикует конкретные
  тарифы: интернет-эквайринг **до 1%**; по картам МИР/СБП/Mastercard/Visa/UnionPay — **до 2%**;
  «Корти Милли» (национальная карта) — **до 1.2%**
  ([dc.tj/bussiness/Acquiring/Acquiring/en/index.php](https://dc.tj/bussiness/Acquiring/Acquiring/en/index.php)).
  Это тариф для мерчанта (аптеки/DoruTJ как получателя платежа), а не «комиссия маркетплейса» —
  его нужно закладывать как расходную статью **до** расчёта комиссии платформы, не путать одно
  с другим.

**Вывод**: комиссия эквайринга (~1–2%) — это отдельная статья расходов, которую либо несёт
DoruTJ (уменьшая свою маржу), либо явно закладывает в свою комиссию сверху. Нужно решение
продукта/финансов (см. REQ-MON-9 и открытые вопросы).

### 1.2 Налоговый контекст Таджикистана

- Стандартная ставка **НДС в Таджикистане — 14%** на период 2024–2026 (с 2027 планируется
  снижение) ([toolsgo.ru: налоги Таджикистана 2026](https://toolsgo.ru/blog/nalogi-tadzhikistana-polnyj-gid);
  подтверждается также подборкой КонсультантПлюс и НК РТ). Медицинские **услуги** освобождены от
  НДС, но **посредническая/агентская/лицензионная услуга** (комиссия маркетплейса, White-Label
  лицензия) под это исключение не подпадает — это не «медицинская услуга», а IT/агентский сервис.
  Из этого следует, что комиссия DoruTJ должна выставляться аптеке/сети **с НДС 14%** сверх суммы
  комиссии, если не будет получено отдельное разъяснение налогового консультанта РТ (см. открытые
  вопросы).
- Полный текст профильного закона «О лекарственных средствах и фармацевтической деятельности»
  (`ncz.tj`) не отдаёт постатейный текст через обычный fetch (сайт — SPA/JS-навигация), поэтому
  **не подтверждено**, есть ли в Таджикистане предельная торговая надбавка на ЖНВЛП (аналогично
  Казахстану/Узбекистану, где такое регулирование есть и найдено в тех же поисковых
  результатах — [adilet.zan.kz](https://adilet.zan.kz/rus/docs/V2100023886),
  [norma.uz](https://www.norma.uz/nashi_obzori/kak_sderjat_rost_cen_na_lekarstva)). Это
  **ASSUMPTION с высоким риском**: если такое регулирование в РТ существует, комиссия платформы
  physически не может увеличивать розничную цену для покупателя на регулируемые позиции — она
  обязана вычитаться из маржи аптеки, а не добавляться сверху.

### 1.3 Сопоставимые модели комиссии маркетплейсов (общий e-commerce, не фарма)

- **Yandex Market**: базовая комиссия **2–25%** в зависимости от категории и схемы работы
  (FBY/FBS/Express/DBS); электроника — 3–10%, одежда/косметика — 10–22%; логистика, эквайринг
  (1.3–2.5%), хранение и Yandex Plus — отдельные статьи, вычитаемые из выплаты продавцу
  ([mpagency.ru](https://mpagency.ru/blog/komissiya-yandeks-market-skolko-platit-i-kak-rasschityvaetsya/);
  [mpstats.io](https://mpstats.io/media/yandex-market/arify-i-komissii)).
- **Общий обзор моделей монетизации маркетплейсов**: комиссия за сделку (Wildberries ~12% на
  автотовары, Ozon ~4–15% по категориям), листинговые сборы, подписка, freemium, комбинированные
  схемы ([sotbit.ru](https://www.sotbit.ru/info/marketplace/komissii-marketpleysa-gayd.html)).
- **Фарм-маркетплейсы (Uteka, apteka.ru, ZdravCity)**: коммерческие условия работы с аптеками
  **не публикуются** ни на одном из проверенных сайтов — подтверждённый пробел, а не недосмотр
  поиска ([uteka.ru/business](https://uteka.ru/business/), [apteka.ru/faq](https://apteka.ru/faq/)).
  Это ожидаемо: аптечная розница по регулируемым позициям имеет тонкую маржу, и агрегаторы обычно
  прячут реальные условия за индивидуальными договорами, а не публичным прайс-листом.
- **Агрегаторы доставки еды** (близкий по механике конкурента — тоже «заказ + курьер + расчёт
  с точкой продаж»): комиссия **17–35%** в зависимости от того, чьими курьерами выполняется
  доставка (собственные курьеры точки — 17–25%; курьеры агрегатора — 29–35%)
  ([academy.chibbis.ru](https://academy.chibbis.ru/kak-vybrat-agregator);
  общий обзор — из поисковой выдачи по Yandex Eda/Delivery Club/Cooper/Chibbis). Этот диапазон
  **неприменим напрямую к фарме**: маржа ресторана на порядок выше маржи аптеки на
  регулируемый рецептурный препарат, поэтому слепое копирование 20–35% привело бы к
  отрицательной марже аптеки на значительной части каталога.

### 1.4 White-Label / SaaS-лицензирование — сопоставимые модели ценообразования

Общепринятые модели white-label SaaS: (a) **flat fee** подписка по тиру, (b) **per-seat/per-unit**,
(c) **usage-based**, (d) **revenue share** (типично **30–40%** в пользу технологического
провайдера в моделях, где провайдер участвует в расчётах с конечным клиентом), плюс почти всегда
**one-time setup/onboarding fee**, покрывающий работу первых недель внедрения
([getmonetizely.com](https://www.getmonetizely.com/articles/white-label-pricing-models-maximizing-value-when-licensing-your-technology);
[smartsaas.works](https://smartsaas.works/blog/post/white-label-saas-pricing-how-to-set-model-for-resellers/118)).
Важно: revenue-share модель предполагает, что провайдер физически видит/участвует в потоке
платежей клиента — что прямо **противоречит Charter §3.4** («деньги тенанта идут на его
мерчант-счёт напрямую, DoruTJ не посредник»). Разрешение этого противоречия — предмет §4 ниже.

---

## 2. Часть A — Комиссия на нейтральном маркетплейсе (B2C, безналичная оплата)

### 2.1 Модель

Тарифицируется **категорийно-тиражированная ставка (tiered by category)** от суммы позиций
заказа (`items_total_tjs`), **без учёта `delivery_fee_tjs`** (доставка — отдельный поток дохода,
100% DoruTJ или делится с курьером — вне скоупа этого документа, пересекается с REQ-DELIV в
`07-telegram-pwa-and-delivery-ops.md`). Обоснование категорийности: рецептурные и ЖНВЛП-подобные
позиции — исторически тонкая маржа и потенциальное гос. регулирование надбавки (§1.2); non-pharma
allied-товары (космметика, БАД, товары для мамы и ребёнка, мед. изделия) в аптеках традиционно
имеют более высокую маржу — это же основание, по которому Yandex Market ставит разную комиссию
по категориям (§1.3).

| Категория (по `medicines.category_id` / признаку `is_prescription_required`) | Комиссия DoruTJ, % от `items_total` | Обоснование |
|---|---|---|
| Рецептурные / препараты из потенциального перечня ЖНВЛП | **5%** (ASSUMPTION) | Низкая маржа + риск гос. регулирования надбавки (§1.2); нижняя граница диапазона Yandex Market (2–25%, §1.3) |
| Безрецептурные (ОTC) лекарства, общий каталог | **8%** (ASSUMPTION) | Средняя точка между фарм-спецификой (тонкая маржа) и общеотраслевым e-commerce минимумом |
| Non-pharma (космметика, БАД, мед. изделия, товары для мамы/ребёнка) | **12%** (ASSUMPTION) | Ближе к средней комиссии Yandex Market по категориям с более высокой маржой (10–22%, §1.3) |

Итоговые проценты — **не найдены в открытых источниках ни для одного фарм-маркетплейса
Центральной Азии/СНГ** (§1.3) и должны пройти утверждение продуктом/финансами до публикации
партнёрам; таблица задаёт **стартовую гипотезу**, откалиброванную от подтверждённых сопоставимых
ставок, а не финальный прайс.

### 2.2 Где считается и фиксируется (снэпшот, не пересчитывать задним числом)

Новая справочная таблица ставок:

```sql
CREATE TABLE commission_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type VARCHAR(20) NOT NULL, -- 'global' | 'category' | 'chain' | 'chain_category'
    chain_id UUID REFERENCES pharmacy_chains(id),   -- NULL для 'global'/'category'
    category_id INT,                                -- NULL для 'global'/'chain'
    rate_bps INT NOT NULL,           -- базисные пункты (100 = 1%), целое число — без float
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to TIMESTAMPTZ,            -- NULL = действует по сей день
    created_by VARCHAR(50) NOT NULL, -- 'admin:<user_id>' — обязательный аудит (Charter §5)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Разрешение конфликтов при резолвинге ставки для конкретной позиции заказа: наиболее специфичный
уровень побеждает — `chain_category` > `chain` > `category` > `global`. Ставка резолвится и
**снэпшотится** в момент создания заказа (не в момент payout), чтобы последующее изменение тарифа
не переписывало историю уже оформленных заказов:

```sql
ALTER TABLE order_items ADD COLUMN commission_bps INT NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN commission_dirams BIGINT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN commission_dirams BIGINT NOT NULL DEFAULT 0; -- SUM(order_items.commission_dirams)
```

### 2.3 Как комиссия проходит через Escrow-ledger и `payout_schedule`

`03-payments-and-escrow.md` уже описывает `escrow_ledger` (append-only) и `payout_schedule`, но
**нигде не вычитает комиссию** — `payout_schedule.amount_dirams` в текущем черновике фактически
равен полной сумме заказа. Это и есть корень пробела REQ-PAY-6. Решение (ADR, см. §5):

```sql
-- Расширение escrow_entry_type
ALTER TYPE escrow_entry_type ADD VALUE 'platform_fee_captured'; -- комиссия удержана в пользу DoruTJ

-- Расширение payout_schedule: раздельно валовая/чистая сумма
ALTER TABLE payout_schedule ADD COLUMN gross_amount_dirams BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payout_schedule ADD COLUMN commission_dirams BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payout_schedule ADD COLUMN net_amount_dirams BIGINT NOT NULL DEFAULT 0; -- = gross - commission
```

Инвариант леджера (проверяется job реконсиляции, §6.6 документа 03): для каждого `order_id`

```
SUM(amount WHERE entry_type = 'hold_created')
  = SUM(amount WHERE entry_type = 'platform_fee_captured')
  + SUM(amount WHERE entry_type = 'captured_to_pharmacy')
  + SUM(amount WHERE entry_type IN ('refunded_to_customer','partially_refunded'))
```

Payout job (уже описан в §6.4 документа 03, шаг 3) при переводе `payout_schedule` из `pending`/`due`
в `paid` теперь пишет **две** строки в `escrow_ledger` в одной транзакции: `platform_fee_captured`
(`amount = commission_dirams`, `idempotency_key = order_id + ':platform_fee'`) и
`captured_to_pharmacy` (`amount = net_amount_dirams`, тот же `idempotency_key`, что уже
предусмотрен в 03 §6.4). Аптека фактически получает **`net_amount_dirams`**, а не полную сумму
заказа — это и есть ответ на «как computer payout_schedule» из формулировки пробела.

---

## 3. Часть B — Биллинг цикл для `cash_courier` (комиссия без прохождения денег через DoruTJ)

Для `cash_courier` деньги вообще не попадают в `escrow_ledger` (уже зафиксировано REQ-PAY-14).
Значит, комиссию нельзя удержать автоматически — нужен классический B2B invoicing цикл, аналогично
тому, как реальные агрегаторы doставки выставляют счета точкам за периодические комиссии, когда
расчёт с точкой идёт вне эквайринга агрегатора.

### 3.1 Новая сущность

```sql
CREATE TYPE billing_invoice_status AS ENUM ('draft', 'issued', 'paid', 'overdue', 'disputed', 'void');
CREATE TYPE billing_invoice_kind AS ENUM ('cash_courier_commission', 'whitelabel_license', 'whitelabel_royalty');

CREATE TABLE platform_billing_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id UUID NOT NULL REFERENCES pharmacy_chains(id),
    kind billing_invoice_kind NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    order_count INT NOT NULL DEFAULT 0,
    gross_amount_dirams BIGINT NOT NULL DEFAULT 0,   -- сумма cash-заказов за период
    commission_dirams BIGINT NOT NULL DEFAULT 0,
    vat_dirams BIGINT NOT NULL DEFAULT 0,            -- 14%, см. §1.2
    total_due_dirams BIGINT NOT NULL DEFAULT 0,       -- commission + vat
    status billing_invoice_status NOT NULL DEFAULT 'draft',
    issued_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_billing_invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES platform_billing_invoices(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id),
    amount_dirams BIGINT NOT NULL
);
```

### 3.2 Цикл (worker job)

1. Ежедневная job (BullMQ, Charter §3.1) агрегирует `delivered`-заказы с `payment_method =
   'cash_courier'` в `draft`-инвойс текущего периода аптечной сети (группировка по `chain_id`).
2. В конце billing-периода — **по умолчанию календарная неделя (ASSUMPTION)**, т.к. еженедельный
   цикл сокращает риск накопления непогашенной задолженности по сравнению с месячным, при
   умеренной нагрузке на бухгалтерию по сравнению с ежедневным — job переводит `draft → issued`,
   выставляет `due_at = issued_at + 7 дней` (net-7), рассчитывает `vat_dirams = commission_dirams
   * 0.14` (см. §1.2) и уведомляет `pharmacy_admin` (push/email/Telegram-бот сети).
3. Оплата — банковским переводом вне системы (счёт выставлен на `legal_entity_name`/`tin_inn` сети
   из `pharmacy_chains`); оператор/финансист DoruTJ вручную помечает `paid` после поступления
   средств (сверка по номеру инвойса в назначении платежа) — ручной шаг, т.к. у DoruTJ нет доступа
   к банковской выписке сети (в отличие от эскроу, где вебхук приходит от банка DoruTJ).
4. Если `now() > due_at + grace_period_days` (ASSUMPTION 3 дня) и статус не `paid` — статус →
   `overdue`; фоновая job блокирует приём новых заказов для этой сети (`pharmacies.is_active =
   false` каскадно по `chain_id`) с уведомлением `pharmacy_admin` и оператора. Разблокировка —
   только ручным действием `super_admin` с аудитом (аналогично `admin_payment_override` из
   REQ-PAY-1).

---

## 4. Часть C — White-Label коммерческая модель

### 4.1 Неразрешённое противоречие между `tz.log` и Charter §3.4 — фиксируется явно

`tz.log` (Часть III) описывает White-Label как: «Полный комплект исходного кода с передачей
**неисключительных прав** и развертыванием **в закрытом контуре заказчика (On-Premise в ЦОД
Таджиктелеком)**» — это модель **разовой продажи лицензии на код** с изолированной инфраструктурой
заказчика, где у DoruTJ физически нет доступа к БД/трафику тенанта после передачи.

Charter §3.4, напротив, описывает **shared multi-tenant SaaS**: «Изоляция: shared DB +
обязательный `chain_id`-скоуп на уровне репозиториев», тенант резолвится middleware по домену —
т.е. все White-Label тенанты **фактически работают на инфраструктуре и в базе данных DoruTJ**,
только с собственным мерчант-аккаунтом для расчётов с покупателем.

Это два разных договорных и архитектурных трека, которые **нельзя обслуживать одной ценовой
моделью**:

| | On-Premise разовая продажа (буква `tz.log`) | Shared multi-tenant SaaS (архитектура Charter §3.4) |
|---|---|---|
| Где крутится код | Инфраструктура заказчика (ЦОД Таджиктелеком) | Инфраструктура DoruTJ |
| Видимость DoruTJ в GMV тенанта после сделки | Отсутствует | Есть (те же таблицы `orders`/`pharmacy_inventory`, просто со scoped `chain_id`) |
| Возможность recurring revenue от DoruTJ | Только через отдельный support-контракт | Возможна (подписка и/или роялти) |
| Требуемая сопровождающая документация | Договор передачи неисключительной лицензии + акт передачи исходного кода | SaaS-договор (оферта/индивидуальный контракт) |

**Рекомендация** (требует подтверждения архитектором/продуктом, т.к. формально не отражено как
пункт таблицы отклонений §3.5 Charter): поскольку Charter уже реализует shared-DB
multi-tenancy как техническое решение (и именно это описано в CUJ-7, тестах на утечку данных
между тенантами), **основным продаваемым предложением считается shared multi-tenant SaaS**, а
буквальный «On-Premise + полный transfer кода» из `tz.log` — это **опциональная bespoke-сделка**
вне стандартного прайсинга платформы (индивидуальный контракт, не описывается в схеме БД
продукта). Ключевой вывод, снимающий кажущееся противоречие с §3.4 «деньги тенанта не
проходят через DoruTJ»: **не проходят деньги, но проходят данные** (заказы лежат в общей
`orders` с `chain_id`) — поэтому DoruTJ технически способен считать GMV тенанта для роялти
**без** доступа к его расчётному счёту, точно так же, как для `cash_courier` (§3).

### 4.2 Предлагаемая модель тарификации (shared multi-tenant SaaS трек)

```sql
CREATE TABLE whitelabel_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id UUID NOT NULL UNIQUE REFERENCES pharmacy_chains(id),
    plan_type VARCHAR(20) NOT NULL, -- 'saas_flat' | 'saas_royalty'
    setup_fee_dirams BIGINT NOT NULL DEFAULT 0,
    monthly_fee_dirams BIGINT NOT NULL DEFAULT 0,
    included_branch_count INT NOT NULL DEFAULT 10,
    extra_branch_fee_dirams BIGINT NOT NULL DEFAULT 0,
    royalty_bps INT,                -- NULL если plan_type = 'saas_flat'
    contract_start DATE NOT NULL,
    contract_end DATE,
    created_by VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Компонент | Ставка (ASSUMPTION) | Обоснование |
|---|---|---|
| Setup fee (разовый, кастомизация за 48 часов из `tz.log`) | **15 000–40 000 TJS**, зависит от объёма кастомизации (палитра/лого — нижняя граница; выделенный Telegram-бот + доп. интеграции — верхняя) | Стандартная практика white-label SaaS — onboarding fee покрывает работу первых недель ([getmonetizely.com](https://www.getmonetizely.com/articles/white-label-pricing-models-maximizing-value-when-licensing-your-technology)) |
| Monthly license fee | **3 000–4 000 TJS** за первые 10 филиалов + **150–250 TJS** за каждый доп. филиал | Per-seat/per-unit модель, распространённая для white-label SaaS ([smartsaas.works](https://smartsaas.works/blog/post/white-label-saas-pricing-how-to-set-model-for-resellers/118)) |
| Revenue share (опционально, `plan_type = 'saas_royalty'`) | **1–2%** от GMV тенанта (не 30–40%, как в «чистых» revenue-share моделях технологических провайдеров — там провайдер несёт весь платёжный риск; здесь платёж идёт мимо DoruTJ, роялти — плата за инфраструктуру/поддержку, а не за расчёты) | Компромисс между «0% — Charter §3.4 буквально» и типовым диапазоном revenue-share 30–40% ([getmonetizely.com](https://www.getmonetizely.com/articles/white-label-pricing-models-maximizing-value-when-licensing-your-technology)), скорректированным на то, что DoruTJ не участвует в движении денег |

Роялти-инвойсы (если план `saas_royalty`) выставляются **тем же механизмом**, что и
`cash_courier`-биллинг (§3): `platform_billing_invoices.kind = 'whitelabel_royalty'`,
`gross_amount_dirams` считается из `orders` тенанта за период (данные есть, т.к. shared DB),
оплата — банковским переводом, вне эскроу.

### 4.3 On-Premise трек (буквальный `tz.log`)

Разовая продажа неисключительной лицензии на исходный код — коммерческая сумма определяется
переговорами (не формула продукта), плюс опциональный годовой support/maintenance контракт,
типично **15–20% от суммы лицензии в год** — общепринятая практика enterprise on-prem софта
(ASSUMPTION по общей практике отрасли, не найден профильный источник для фарм-рынка ЦА).
Эта ветка **не описывается таблицами БД DoruTJ** — она вне платформы (отдельный юридический
документ), т.к. по определению трека DoruTJ теряет доступ к инфраструктуре после передачи.

---

## 5. ADR: где в схеме живёт комиссия

**Контекст**: нужно решить, комиссия — это (a) поле на `orders`, (b) поле на `order_items`,
(c) отдельная запись в `escrow_ledger`, или (d) комбинация.

**Решение**: комбинация (b) + (c) + расширение `payout_schedule`, а не единственное поле
`commission_tjs` на `orders`.

**Обоснование**:
1. Ставка тарифицируется по категории (§2.1), значит источник истины — `order_items` (там есть
   `medicine_id → category_id`), а не агрегат на `orders`. Поле на `orders` — денормализованная
   сумма (`SUM`), нужная для отчётности, но не источник истины.
2. `escrow_ledger` — уже принятый в проекте append-only паттерн для денежных движений (03 §6.2).
   Заведение отдельного `entry_type = platform_fee_captured` сохраняет единый инвариант
   «сумма списаний = сумма списаний» и делает реконсиляцию (03 §6.6) тривиальным SQL-запросом,
   не требуя специального кода для комиссии.
3. Одного поля `commission_tjs` на `orders` **недостаточно** для `cash_courier`, где нет ledger
   вообще — там нужна отдельная сущность биллинга (§3), которая ссылается на заказы
   (`platform_billing_invoice_lines.order_id`), но не хранит сумму как «факт эскроу».

**Альтернатива, которая была отклонена**: единственное вычисляемое поле `orders.commission_tjs`
без снэпшота по позициям — отклонено, т.к. не позволяет тарифицировать по категориям внутри
одного заказа (заказ может содержать и рецептурный препарат, и БАД одновременно).

---

## 6. Итоговая сводная таблица тарифов

| Поток дохода | Модель | Ставка (все — ASSUMPTION до утверждения) | Где фиксируется | Механизм получения денег |
|---|---|---|---|---|
| Neutral marketplace, безнал | % от `items_total`, по категории | 5% / 8% / 12% (см. §2.1) | `order_items.commission_bps` → `escrow_ledger.platform_fee_captured` | Автоудержание перед payout (T+1..T+3, REQ-PAY-6) |
| Neutral marketplace, `cash_courier` | Тот же %, без эскроу | Те же ставки | `orders.commission_dirams` → `platform_billing_invoices` | Инвойс, недельный цикл, net-7 |
| Delivery fee | Отдельный поток, не делится с аптекой | 100% DoruTJ (доля курьера — вне скоупа, см. REQ-DELIV) | `orders.delivery_fee_tjs` | Уже в текущей схеме |
| White-Label SaaS, setup | Разовый | 15 000–40 000 TJS | `whitelabel_contracts.setup_fee_dirams` | Инвойс при подписании |
| White-Label SaaS, monthly | Per-branch tier | 3 000–4 000 TJS / 10 филиалов + 150–250 TJS/доп. | `whitelabel_contracts.monthly_fee_dirams` | Инвойс, авансом за месяц |
| White-Label SaaS, royalty (опционально) | % от GMV тенанта | 1–2% | `whitelabel_contracts.royalty_bps` → `platform_billing_invoices.kind='whitelabel_royalty'` | Тот же цикл, что cash_courier |
| White-Label On-Premise (буква `tz.log`) | Разовая продажа лицензии + support | Договорная сумма + 15–20%/год support | Вне схемы БД продукта | Отдельный юридический договор |

Все процентные ставки НДС-облагаемые (14%, см. §1.2) — инвойс обязан показывать комиссию и НДС
отдельными строками.

---

## Требования, вытекающие из исследования

1. **REQ-MON-1**: Ставка комиссии (`commission_bps`) обязана резолвиться и **сниматься снэпшотом**
   на `order_items` в момент оформления заказа; последующее изменение `commission_rates` не должно
   изменять уже оформленные заказы задним числом.
2. **REQ-MON-2**: Для заказов, оплаченных через `alif_mobi`/`dc_next` (эскроу), удержание
   комиссии платформы обязано фиксироваться отдельной записью `escrow_ledger` с
   `entry_type = 'platform_fee_captured'` и `idempotency_key = order_id + ':platform_fee'`,
   записываемой в той же транзакции/job, что и `captured_to_pharmacy`.
3. **REQ-MON-3**: Для каждого `order_id` обязан выполняться инвариант леджера:
   `SUM(hold_created) = SUM(platform_fee_captured) + SUM(captured_to_pharmacy) +
   SUM(refunded_to_customer | partially_refunded)`; job реконсиляции (03 §6.6) обязан проверять
   этот инвариант и алертить при расхождении.
4. **REQ-MON-4**: `payout_schedule` обязана содержать поля `gross_amount_dirams`,
   `commission_dirams`, `net_amount_dirams`; payout job обязан переводить аптеке
   исключительно `net_amount_dirams`.
5. **REQ-MON-5**: Комиссия платформы не начисляется на `delivery_fee_tjs` — база расчёта
   строго `items_total` соответствующей позиции заказа, если продукт/финансы не утвердят иное.
6. **REQ-MON-6**: Для `payment_method = 'cash_courier'` система обязана ежедневно агрегировать
   `delivered`-заказы аптечной сети в `draft`-инвойс (`platform_billing_invoices`,
   `kind = 'cash_courier_commission'`) и в конце billing-периода (по умолчанию — календарная
   неделя) переводить его в `issued` с `due_at = issued_at + 7 дней`.
7. **REQ-MON-7**: Если инвойс не оплачен спустя `due_at + grace_period_days` (по умолчанию 3 дня),
   система обязана автоматически перевести все аптеки сети в `is_active = false`
   (блокировка приёма новых заказов) с уведомлением `pharmacy_admin` и оператора; разблокировка —
   только явным действием `super_admin` с обязательным `reason` и аудитом.
8. **REQ-MON-8**: Таблица `commission_rates` обязана поддерживать разрешение по специфичности
   (`chain_category` > `chain` > `category` > `global`) с датами `valid_from`/`valid_to`; все
   изменения ставок обязаны логироваться с `created_by` и попадать под требование аудита
   мутирующих операций (Charter §5).
9. **REQ-MON-9**: Все инвойсы (`cash_courier_commission`, `whitelabel_license`,
   `whitelabel_royalty`) обязаны отдельными строками показывать сумму комиссии/лицензии и НДС
   (14% на дату документа, см. §1.2), а не единую сумму «к оплате».
10. **REQ-MON-10**: Коммерческие условия White-Label (`whitelabel_contracts`: setup fee, monthly
    fee, `royalty_bps`) обязаны храниться отдельно от операционных `tenant_settings` (брендинг,
    домен, telegram-бот) и быть доступны только ролям с финансовыми правами (не
    `pharmacy_admin` тенанта), т.к. это коммерчески чувствительные данные другого уровня
    конфиденциальности.
11. **REQ-MON-11**: Для White-Label-тенантов на `plan_type = 'saas_royalty'` расчёт GMV для
    роялти обязан использовать те же данные `orders`/`chain_id`, что и операционные отчёты (shared
    DB согласно Charter §3.4) — не требуется отдельный канал получения данных о продажах тенанта.
12. **REQ-MON-12**: Комиссия платформы (эквайринг ~1–2% по данным DC Bank, §1.1) обязана
    учитываться как отдельная расходная статья в расчёте маржи DoruTJ и не смешиваться в одной
    цифре с комиссией платформы, взимаемой с аптеки — это две разные стороны P&L.

## Открытые вопросы

1. Точные проценты комиссии (5%/8%/12%) — это калиброванная от сопоставимых рынков гипотеза,
   **не найденный факт**: ни один фарм-маркетплейс региона не публикует коммерческие условия.
   Требуется утверждение продуктом/финансами до подписания первого договора с аптекой.
2. Есть ли в Таджикистане предельная торговая надбавка (аналог ЖНВЛП-регулирования Казахстана/
   Узбекистана) — полный текст профильного закона РТ не удалось получить (сайт `ncz.tj` отдаёт
   только навигацию через обычный fetch). Если такое регулирование есть, ставки §2.1 для
   рецептурных позиций могут потребовать пересмотра вниз или отдельного согласования с
   Минздравом РТ.
3. Реальная комиссия эквайринга Alif/DC Bank **для DoruTJ как агрегатора** (не конечного
   мерчанта) — публичные тарифы могут не совпадать с агентским/партнёрским договором для
   маркетплейса; нужен прямой запрос в отделы партнёрств обоих банков.
4. Ключевое архитектурное решение не зафиксировано ни в Charter, ни в `tz.log` явно: считать ли
   White-Label продуктом shared multi-tenant SaaS (по факту архитектуры §3.4) или буквальным
   On-Premise переносом кода (по факту текста `tz.log` Части III)? От ответа зависит, нужна ли
   таблица `whitelabel_contracts` вообще, или White-Label — это чисто юридический трек вне
   продуктовой схемы БД. Требуется явное решение архитектора, желательно оформленное как ADR в
   `docs/adr/`.
5. Периодичность биллинг-цикла для `cash_courier` и `whitelabel_royalty` (неделя vs месяц) —
   ASSUMPTION; выбор влияет на нагрузку на бухгалтерию DoruTJ и на риск накопления
   непогашенной задолженности аптечными сетями.
6. Как трактуется НДС для аптек/сетей на упрощённом налоговом режиме (патент) в РТ — нужен
   налоговый консалтинг по местному законодательству, не покрывается веб-поиском.
7. Делится ли `delivery_fee_tjs` с курьером как процент от суммы или фиксированная ставка/смена —
   пересекается с `07-telegram-pwa-and-delivery-ops.md` (REQ-DELIV), но напрямую влияет на итоговый
   P&L DoruTJ и требует согласования на уровне модели монетизации в целом.
8. Нужно ли договорное право DoruTJ на аудит/проверку данных о продажах White-Label тенанта,
   если тенант в будущем перейдёт на изолированную (не shared-DB) инфраструктуру — иначе
   `saas_royalty`-модель перестанет быть проверяемой.
