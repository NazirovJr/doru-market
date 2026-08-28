# Research 03 — Платежи и Escrow (DoruTJ)

> Область: платёжные провайдеры Таджикистана, эквайринг Visa/Mastercard, национальные
> QR/карточные стандарты, hold/capture, защита от поддельных чеков, целевой интерфейс
> `PaymentProvider`. Источник входных требований: `tz.log` §Модуль 3, Charter §3.3 (`PaymentProvider`),
> Charter §5 (запрет ручного подтверждения оплаты, HMAC вебхуков), Charter CUJ-2/CUJ-4.
>
> Методология: для каждого провайдера ниже указано, что подтверждено публичным источником,
> что является ASSUMPTION (логический вывод без прямого документа) и что UNVERIFIED
> (не найдено вообще, либо найдено только маркетинговое описание без технической спецификации).
> Ни один из провайдеров, перечисленных в задании, **не публикует полную открытую API-документацию
> для внешних торговых точек** — это ключевой вывод исследования, определяющий архитектуру §5.

---

## 1. Ландшафт платёжной инфраструктуры Республики Таджикистан

### 1.1 Нормативная база

- Закон РТ «О платёжных услугах и платёжной системе» №1397 от 24.02.2017 — базовый закон,
  регулирующий платёжные организации, эмитентов электронных денег, переводы электронных
  денежных средств; надзорный орган — Национальный банк Таджикистана (НБТ).
  [nbt.tj/ru/payment_system](https://nbt.tj/ru/payment_system/)
- Указ Президента РТ №586 от 22.06.2023 «О мерах по расширению безналичных расчётов» — с
  01.08.2023 все госплатежи (налоги, пошлины, штрафы, ЖКУ) обязаны проводиться безналично.
  Издан как драйвер cashless-экосистемы, на которую ссылается tz.log (>80% безнала в городах).
  [khovar.tj — система безналичных платежей](https://khovar.tj/rus/2023/12/sistema-beznalichnyh-platezhej-v-tadzhikistane-chto-tormozit-eyo-vnedrenie-kak-reshayutsya-problemy/)
- НБТ развивает единую систему быстрых платежей (аналог российской СБП) и разворачивает
  **«Национальный свитч»** для межбанковской маршрутизации в реальном времени; в 2023 году
  запущен проект **единого межбанковского QR-кода**, позволяющий оплачивать товары/услуги
  через кошельки разных банков по одному коду.
  [khovar.tj — платёжный шлюз для госуслуг](https://khovar.tj/rus/2025/10/tadzhikistan-planiruet-vvod-v-dejstvie-platyozhnogo-shlyuza-dlya-gosudarstvennyh-uslug/)
  **UNVERIFIED**: точная техническая спецификация этого единого QR (TLV-формат по типу
  EMVCo/НСПК, набор тегов, версия) нигде не опубликована в открытом доступе — найдено только
  журналистское упоминание факта существования проекта, без ссылки на технический стандарт
  или орган, публикующий спецификацию. Считать, что "национальный EMVCo-подобный QR" полностью
  публично специфицирован, **нельзя**.
- К 2023 г. в РТ развёрнуто >1 178 QR-точек и >3 000 платёжных терминалов на государственных
  объектах, что говорит о физическом масштабе, но не о наличии открытого API для маркетплейсов.
  [khovar.tj](https://khovar.tj/rus/2023/12/sistema-beznalichnyh-platezhej-v-tadzhikistane-chto-tormozit-eyo-vnedrenie-kak-reshayutsya-problemy/)

### 1.2 Участники (кошельки/банки), релевантные DoruTJ

| Провайдер | Юр. статус | Что публично известно | Источник |
|---|---|---|---|
| **Alif Mobi** | продукт Alif Bank (входит в Alif Capital Holdings, работает также в Узбекистане под брендом Alifpay) | Эквайринг Korti Milli/Visa/Mastercard, POS+QR+онлайн; клиент подтверждает оплату сканированием QR в приложении Alif Mobi или переходом по диплинку | [alif.tj/en/business/merchant-acquiring](https://alif.tj/en/business/merchant-acquiring) |
| **DC Next** (Dushanbe City Bank) | e-wallet банка DC | QR-оплата, NFC, эквайринг «карты + кошельки + баланс телефона»; для подключения — заявка через сайт, без публичного API | [dc.tj/bussiness/Acquiring](https://dc.tj/bussiness/Acquiring/), [next.dc.tj](https://next.dc.tj/) |
| **Humo Online** | продукт **тадж. банка «Хумо»** (НЕ путать с узб. национальной карточной системой HUMO/NCIS — тёзка, другое юрлицо, другая страна) | Переводы по телефону/QR/NFC, оплата 70+ сервисов | [humo.tj](https://humo.tj/ru/personal/mobile-banking/), [the-tech.kz — обзор кошельков](https://the-tech.kz/czifrovye-koshelki-tadzhikistana-kto-lidiruet-na-rynke-i-v-chem-ih-otlichie) |
| **Amonatbonk / Amonat Mobile** | госбанк («народный банк Таджикистана») | QR-оплата, переводы, ЖКУ; часть провайдеров задействуют Amonatbank как расчётный хаб для >250 видов госуслуг | [amonatbonk.tj](https://www.amonatbonk.tj/ru/amonat-mobile/), [khovar.tj](https://khovar.tj/rus/2023/12/sistema-beznalichnyh-platezhej-v-tadzhikistane-chto-tormozit-eyo-vnedrenie-kak-reshayutsya-problemy/) |
| **Корти Милли** | национальная карточная система, создана НБТ в январе 2012 | >3 млн карт, >20 банков-эмитентов, >3 705 POS, co-badge с картами «Мир» с 2023 г.; технически ведёт себя как локальный карточный бренд (аналог Visa/Mastercard в масштабе страны), НЕ является QR-стандартом | [ru.wikipedia.org/Корти_Милли](https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D1%80%D1%82%D0%B8_%D0%9C%D0%B8%D0%BB%D0%BB%D0%B8) |
| **Visa / Mastercard** | международные схемы, эмитируются локальными банками (Alif, Eskhata, Spitamen, Amonatbonk, IBT и др.) | Эквайринг доступен через Alif Bank и другие банки-партнёры; отдельного публичного API для мелких мерчантов не найдено | [cis.visa.com/visa-in-tajikistan](https://cis.visa.com/visa-in-tajikistan.html), [alif.tj/en/business/merchant-acquiring](https://alif.tj/en/business/merchant-acquiring) |
| **ССП «Пайванд»** (справочно) | объединение Payvand + Pardohti Fawri (экс-QIWI) + Levakand Tijorat | Крупнейший процессинг терминалов и электронных кошельков в РТ (>5 млн пользователей, >800–3000 терминалов); не упомянут в задании явно, но фактически часть инфраструктуры cashless-платежей и потенциальный агрегатор | [payvand.tj](https://www.payvand.tj/providers) |
| **Smartpay.tj** | независимый платёжный агрегатор для РТ | Заявлен как единая точка интеграции: VISA/Mastercard/AMEX + локальные кошельки (DC Next, Eskhata Online, Humo Pay, Amonat Mobile, IMON Online, MyBabilon и др.) одним контрактом | [smartpay.tj](https://smartpay.tj/), поиск по агрегаторам ([hulkapps.com](https://www.hulkapps.com/blogs/shopify-payment-providers/xendit-payment-gateway-new-shopify-integration-in-tajikistan)) |

**Ключевой вывод для архитектуры**: ни у одного из банковских провайдеров РТ (Alif Mobi,
DC Next, Humo, Amonatbonk) не найдено публичной технической документации API (endpoints,
JSON-схемы, вебхуки) — все страницы банков являются маркетинговыми лендингами с формой заявки
«свяжется менеджер». Единственная **реально существующая публичная API-документация**, пригодная
как технический референс, принадлежит **Alifpay** (`docs.alifpay.uz`) — продукту той же группы
Alif Capital Holdings, но зарегистрированному для рынка Узбекистана. Ниже она разобрана подробно
как лучший доступный прокси для ожидаемого контракта Alif Mobi в Таджикистане — с явной пометкой,
что 1:1-идентичность контракта **не подтверждена** для таджикского юрлица.

---

## 2. Alif — детальный разбор публичного API (Alifpay, `docs.alifpay.uz`)

**ASSUMPTION**: Alif Bank (TJ, продукт Alif Mobi) и Alifpay (UZ) — разные юрлица одной группы
Alif Capital Holdings, работающей в Узбекистане, Таджикистане и Пакистане
([alif.uz/en](https://www.alif.uz/en/), [alif.holdings](https://www.alif.holdings/)). Контракт
Alif Mobi TJ может отличаться в деталях (эндпоинты, лимиты, набор методов), но архитектурная
модель (bill/invoice → QR/deeplink → webhook, HMAC-подпись, hold по токену карты) — наиболее
вероятный шаблон, на который стоит ориентироваться при написании реального адаптера
`AlifMobiProvider`, до получения контракта у самого Alif Bank TJ (`support@alif.tj`,
+992 48 888 5353).

### 2.1 Базовые параметры
- Base URL (UZ-инстанс): `https://api.alifpay.uz`.
- Авторизация: HTTP-заголовок `Token` (или `Store-Token` для мультимагазинных интеграций).
- Суммы — в минимальной денежной единице (тийин для UZS); диапазон одной операции:
  50 000–20 000 000 000 (мин/макс). Для TJS у DoruTJ используются **дирамы** (Charter §5:
  1 TJS = 100 дирам) — конвертация суммы в единицы провайдера обязана быть explicit-мэппингом
  внутри адаптера, а не общим полем.
- [docs.alifpay.uz](https://docs.alifpay.uz/), [docs.alifpay.uz/v1](https://docs.alifpay.uz/v1/)

### 2.2 Создание счёта / инвойса (`POST /invoice`, checkout-модуль)
Поля запроса: `items[]` (`name`, `amount`, `price`, `discount`, `spic`, `marking_code`,
`vat_percent`, `tin`/`pin`), `phone`, `cancel_url`, `redirect_url`, `webhook_url` (все — HTTPS),
`receipt` (флаг фискализации), `timeout` (сек. до истечения счёта), `payouts[]` (сплит выплат
на разных получателей — `amount` + `tin`/`pin`), `meta` (произвольный JSON).
Ответ: `id` (уникальный идентификатор счёта), `price`, `created_at` (ISO-8601), эхо входных полей.
[docs.alifpay.uz/checkout](https://docs.alifpay.uz/checkout/)

Важно для DoruTJ: поле `payouts[]` с указанием `tin`/`pin` получателя — прямой аналог
маршрутизации денег на счёт конкретной аптеки (`pharmacy_chains.tin_inn` уже есть в схеме БД
Charter §3). Это подтверждает, что сплит-выплаты — стандартная фича у Alif-группы, и адаптер
`AlifMobiProvider` должен уметь передавать `payoutAccountId`/`tin` аптеки как параметр создания
счёта, а не только у себя в ledger.

### 2.3 Способ оплаты и QR (`POST /pay`)
Метод `/pay` принимает 4 типа `method`: `CARD`, `TOKEN`, `HOLD`, **`MOBI_SHOW_QR`**.
`MOBI_SHOW_QR` — это именно механизм «покажи QR, отсканируй в приложении Alif Mobi», прямое
попадание в описанный в tz.log флоу «Checkout (QR) → Pay via DeepLink».
[docs.alifpay.uz/checkout](https://docs.alifpay.uz/checkout/)

**UNVERIFIED**: содержимое самого QR (TLV/EMVCo-подобный payload или проприетарный
JSON/URL-encoded токен, который просто открывает приложение по deeplink) нигде не
задокументировано публично. Наиболее вероятная гипотеза (не подтверждена): QR кодирует URL вида
`https://checkout.alifpay.uz/?invoice=<id>` — такой паттерн явно документирован для
web-редиректа счёта ([docs.alifpay.uz/checkout](https://docs.alifpay.uz/checkout/)), и вероятно
переиспользуется как payload QR для мобильного сканирования. Однозначного национального
EMVCo-QR-стандарта, к которому Alif обязан был бы привязываться, не найдено (см. §1.1).

### 2.4 Статусы транзакции
`SUCCEEDED`, `PENDING`, `PENDING_REVERSAL`, `DECLINED`, `REVERTED`,
`INSUFFICIENT_FUNDS`, `EXPIRED_CARD`, `BLOCKED_CARD`, `INVALID_CARD`,
`OTP_REQUIRED`, `INCORRECT_OTP`, `EXPIRED_OTP`, `SMS_NOTIFICATION_IS_OFF`, `UNKNOWN_ERROR`.
[docs.alifpay.uz/payments](https://docs.alifpay.uz/payments/)

### 2.5 Двухстадийная оплата (hold/capture)
- `POST /hold` — резервирование средств по токену карты. Поля: `id` (уникальный ID операции на
  стороне клиента API — фактически идемпотентный ключ), `amount`, `token`. Ответ: `id`, `amount`,
  `created_at`, `dismissed` (bool).
- **Автоматическое снятие холда**: для карт Humo холд автоматически отменяется через **10 дней**,
  если не был захвачен или отменён вручную. [docs.alifpay.uz/hold](https://docs.alifpay.uz/hold/)
- **Явного отдельного endpoint'а "capture"/"confirm" не существует** — списание удержанной суммы
  выполняется тем же `/pay` с `method=HOLD`, ссылающимся на `id` холда (т.е. hold используется как
  предавторизованный источник средств для последующего платежа, а не как отдельный стейт-переход
  с отдельным API).
- Отмена холда: `POST /dismissHold` (`id` → `dismissed: true`).
- Статус холда: `POST /getHold`.
[docs.alifpay.uz/hold](https://docs.alifpay.uz/hold/)

**Вывод**: hold/capture в этом API привязан к **токену карты**, а не к «счёту» (invoice/bill),
и, по всей видимости, ориентирован на p2p/маркетплейс-сценарии с сохранённой картой, а не на
QR-платёж через приложение-кошелёк. **UNVERIFIED**, поддерживает ли `MOBI_SHOW_QR` (оплата
сканированием QR в приложении Alif Mobi — основной ожидаемый флоу DoruTJ) двухстадийный
hold/capture в принципе — судя по документации, hold требует предварительно сохранённого
`token` карты, который в QR-флоу до оплаты не существует. **Это ключевой архитектурный риск**:
следует считать по умолчанию, что для реального сценария DoruTJ (гость сканирует QR один раз,
без сохранения карты) провайдерский hold/capture, скорее всего, недоступен, и полагаться нужно
на программный escrow DoruTJ (см. §4), а не на банковский hold.

### 2.6 Рефанды
- `POST /refundPayment` — полный возврат с фискальным чеком возврата.
- `POST /refundPaymentPartial` — частичный возврат, **доступен только для оплат в рассрочку**
  (`min amount` 50 000 тийин), статусы `DONE` / `PENDING` / `FAILED`.
- При ошибке возврата статус может прийти `FAILED` **без указания причины** — это существенно
  для проектирования реконсиляции (см. §6): нельзя полагаться на текстовое поле ошибки
  провайдера, нужен отдельный ручной процесс расследования зависших рефандов.
[docs.alifpay.uz/payments](https://docs.alifpay.uz/payments/)

**UNVERIFIED**: поддержка частичного рефанда для обычных (не в рассрочку) платежей. Если это
поведение сохраняется и в Alif Mobi TJ, DoruTJ не может полагаться на частичный возврат от
провайдера в общем случае (например, частичный возврат за 1 товар из заказа с несколькими
позициями) — такие частичные возвраты нужно реализовывать как **внутренний ledger-эффект**
(см. §5) с последующим полным возвратом на провайдере, если применимо, либо взаимозачётом.

### 2.7 Вебхуки: подпись и retry
- Заголовок `Signature` = `HMAC-SHA256(secret_key, raw_request_body)`, результат в base64.
  Проверка: пересчитать HMAC на своей стороне и сравнить со значением заголовка constant-time.
- Ретраи: «запросы обычно отправляются в течение часа, пока не будет получен ответ 200 OK»;
  если доставить вебхук за это окно не удаётся — **платёж отменяется и деньги возвращаются
  клиенту** банком.
[docs.alifpay.uz/v1](https://docs.alifpay.uz/v1/)

Это прямо подтверждает решение Charter §5 «идемпотентность вебхуков» и даёт конкретный SLA
для проектирования: DoruTJ обязан отвечать `200` на вебхук **до** истечения банковского окна
ретраев (принимать событие быстро — записать в БД и вернуть `200`, тяжёлую бизнес-логику
выполнять асинхронно), иначе банк молча отменит платёж без уведомления второй стороны сверх
собственных ретраев.

### 2.8 Sandbox (для разработки MockBank-независимого адаптера, когда появятся боевые ключи)
Изолированное окружение без реальных банков, тестовые карты (валидная / недостаточно средств /
просрочена / заблокирована / SMS отключены), тестовый OTP `111111`, тестовый PINFL
`11111111111111`, срок действия — любая будущая дата `MMYY`.
[docs.alifpay.uz/sandbox](https://docs.alifpay.uz/sandbox)

---

## 3. Остальные провайдеры — что подтверждено, что нет

### 3.1 DC Next / Dushanbe City Bank
Подтверждено маркетингом: приём Visa/Mastercard/Korti Milli/кошельков/баланса телефона через
POS, QR и «internet-эквайринг» для сайтов и мобильных приложений (Android/iOS SDK упоминается
общими словами, без спецификации); реальное зачисление средств; подключение только через заявку
и личный кабинет после открытия расчётного счёта в DC.
[dc.tj/bussiness/Acquiring](https://dc.tj/bussiness/Acquiring/), [next.dc.tj](https://next.dc.tj/)
Комиссии эквайринга (маркетинговая страница): 1% обычные платежи / 3% кредитные операции.
**UNVERIFIED**: API-эндпоинты, формат вебхука, поддержка hold/capture, формат QR, deeplink-схема
приложения DC Next (`tj.dc.next1` — Android package name,
[play.google.com](https://play.google.com/store/apps/details?id=tj.dc.next1)). Ничего из этого
не публикуется без подписания коммерческого договора.

### 3.2 Humo Online (банк «Хумо», Таджикистан)
**Важное уточнение для команды**: название «Humo Online» из tz.log — это тадж. банк «Хумо»
(мобильный банкинг, сайт `humo.tj`, приложение «Хумо Онлайн»/«Хумо Переводы»), а **не** узбекская
национальная карточная система HUMO (оператор — Национальный процессинговый центр Узбекистана,
`humocard.uz`). Это два разных юрлица из разных стран с похожими названиями — риск путаницы при
поиске документации и при написании ADR/задач для разработчиков.
[humo.tj/ru/personal/mobile-banking](https://humo.tj/ru/personal/mobile-banking/),
[humocard.uz/en](https://humocard.uz/en/)
Подтверждено: переводы на карты Korti Milli/кошельки (в т.ч. Alif Mobi) по номеру телефона,
QR, NFC, >70 видов услуг. **UNVERIFIED**: любая техническая API-документация для мерчантов.

### 3.3 Amonatbonk / Amonat Mobile
Госбанк, приложение «Амонат мобайл»: ЖКУ, переводы, QR-платежи, конвертация валют.
[amonatbonk.tj](https://www.amonatbonk.tj/ru/amonat-mobile/). Amonatbank также выступает
расчётным хабом минимум для >250 видов государственных услуг, интегрированных с приложениями
других банков — то есть исторически способен на межбанковскую маршрутизацию.
[khovar.tj](https://khovar.tj/rus/2023/12/sistema-beznalichnyh-platezhej-v-tadzhikistane-chto-tormozit-eyo-vnedrenie-kak-reshayutsya-problemy/)
**UNVERIFIED**: публичный API эквайринга для частных маркетплейсов.

### 3.4 Корти Милли
Национальная карточная схема (не e-wallet, не QR-стандарт) — карты выглядят и обрабатываются
как Visa/Mastercard локального уровня, эмитируются >20 банками, с 2023 г. — co-badge с картами
«Мир». Для DoruTJ это означает: приём Корти Милли реализуется **тем же эквайринговым
контрактом**, что и Visa/Mastercard (через банк-эквайер), отдельного «API Корти Милли» для
маркетплейса нет и не должно быть.
[ru.wikipedia.org/Корти_Милли](https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D1%80%D1%82%D0%B8_%D0%9C%D0%B8%D0%BB%D0%BB%D0%B8)

### 3.5 Visa / Mastercard эквайринг
Эмитируются 13+ банками-партнёрами (включая Alif, Humo, Amonat) — [cis.visa.com/visa-in-tajikistan](https://cis.visa.com/visa-in-tajikistan.html).
Эквайринг по факту предоставляется теми же банками, что дают локальные кошельки (Alif Bank,
и др.) — отдельного «чистого» карточного эквайера с публичным API не обнаружено.
**ASSUMPTION**: для DoruTJ карточный эквайринг Visa/Mastercard технически придёт через тот же
адаптер, что и Alif Mobi (единый мерчант-контракт банка на карты + Alif Mobi QR), то есть
`AlifMobiProvider` в терминологии Charter, скорее всего, должен закрывать оба канала
(QR-кошелёк + карты) одним набором учётных данных банка, а не два отдельных `PaymentProvider`.

### 3.6 Агрегаторы: Smartpay.tj и ССП «Пайванд»
Smartpay.tj публично заявляет единую интеграцию для VISA/Mastercard/AMEX + локальных кошельков
одним контрактом ([hulkapps.com](https://www.hulkapps.com/blogs/shopify-payment-providers/xendit-payment-gateway-new-shopify-integration-in-tajikistan)),
но собственная документация API на `smartpay.tj` недоступна публично (страница — маркетинговый
лендинг). ССП «Пайванд» (бывш. QIWI TJ + Levakand Tijorat) — крупнейшая терминальная сеть,
>5 млн пользователей ([payvand.tj](https://www.payvand.tj/providers)), тоже без публичного API.
**Рекомендация**: на старте переговоров с провайдерами имеет смысл параллельно запросить
техническую документацию у Smartpay.tj как у агрегатора — потенциально один контракт вместо
четырёх банковских, что резко упрощает список `PaymentProvider`-реализаций. Требует
верификации у самого Smartpay (не найдено публично).

---

## 4. Итог по разделу «нацстандарт QR»

Ни один официальный источник не подтверждает, что таджикский «единый QR» 2023 года построен по
спецификации EMVCo Merchant-Presented QR ([EMVCo QR spec, официальный источник](https://www.emvco.com/emv-technologies/qr-codes/))
или по аналогии с российским НСПК/СБП QR. Подтверждён только факт существования
межбанковской интероперабельности QR-платежей на уровне отдельных пилотов
(госплатежи, кошельки). Поэтому DoruTJ должен спроектировать генерацию QR **не** как
единый статический алгоритм, а как **функцию конкретного `PaymentProvider`**: каждый адаптер
возвращает готовый `qrPayload`/`qrImageUrl`/`deeplinkUrl`, сформированный самим банком
(в случае Alif — вероятно, URL счёта вида `checkout.alifpay.uz/?invoice=<id>`, см. §2.3),
а DoruTJ лишь рендерит то, что вернул провайдер, не пытаясь конструировать TLV-payload
самостоятельно, пока не получен официальный контракт конкретного банка с образцом QR.

---

## 5. Проблема поддельных чеков (fake payment screenshots) и как её решают другие площадки

### 5.1 Природа проблемы (подтверждена tz.log и открытыми источниками)
Мошенник присылает продавцу/курьеру отфотошопленный скриншот «оплата прошла» через СБП/кошелёк,
не переводя реальных денег, и торопит с отгрузкой товара до проверки — распространённая на
маркетплейсах и в C2C-продажах схема в СНГ.
[статья о мошенничестве на маркетплейсах](https://xn--90a1bg.xn--p1ai/articles/finansy/moshenniki-na-marketpleysakh/)

### 5.2 Как решают крупные площадки (аналоги для DoruTJ)
- **Wildberries**: продавец получает деньги только после согласования финансового отчёта, а
  выплата — не ранее, чем через фиксированный интервал после этого (14 дней после реформы
  2025 г.; до этого — 21 день); отсчёт идёт не от даты доставки, а от даты согласования отчёта.
  [selsup.ru — сокращение сроков выплат](https://selsup.ru/blog/wildberries-sokratil-sroki-vyplat-prodavtsam-do-14-dnej-chto-izmenilos/)
- **Uzum Market**: оферта прямо разрешает площадке отложить выплату продавцу до 4 рабочих дней
  сверх планового графика (банковские нерабочие дни и т.п.) — то есть договорной SLA с явным
  буфером, а не «мгновенно по факту доставки».
  [seller.uzum.uz/manual/3.tariffs](https://seller.uzum.uz/manual/3.tariffs/)
- Общий паттерн обеих площадок: **эскроу как отложенный выплатной цикл (payout cycle) с
  зафиксированным SLA**, а не как единичная банковская hold/capture-транзакция — то есть именно
  тот механизм, который Charter §3.3 просит реализовать программно, если банк не даёт
  двухстадийной оплаты.
- Специфичный для DoruTJ вывод (уже заложен в tz.log и Charter): **единственный источник истины
  об оплате — подписанный вебхук банка**; ручная загрузка скриншотов в чат/статус заказа
  запрещена категорически (Charter §5: «категорический запрет на изменение статуса оплаты чем-либо
  кроме серверного вебхука»). Это устраняет саму атаку класса «фейковый скриншот» на уровне
  архитектуры, а не только процесса — в БД физически нет поля/действия, которым фармацевт мог бы
  вручную выставить `paid_escrow`.

### 5.3 Что дополнительно нужно предусмотреть
1. Кнопка/форма «прикрепить скриншот оплаты» не должна существовать нигде в UI фармацевта или
   курьера — ни как fallback, ни как «на всякий случай» (это отдельный тестируемый инвариант,
   не только документная норма).
2. Любое ручное вмешательство в статус оплаты (например, саппортом при споре) обязано идти через
   отдельный `admin_payment_override` с обязательным free-text обоснованием, ролью `super_admin`
   и записью в audit log — то есть не «поставить paid», а «искусственно смоделировать приход
   вебхука» с полной трассировкой кто/когда/почему.
3. Реконсиляция (см. §6.6) должна быть активным процессом (job по расписанию), а не пассивным
   ожиданием вебхука — чтобы ловить случаи, когда деньги реально пришли, а вебхук потерялся
   (обратный случай мошенничества — недоверие площадки к самой себе — тоже стоит денег).

---

## 6. Программная реализация Escrow на стороне DoruTJ

Поскольку (а) ни один провайдер РТ не документирует публично полноценный hold/capture по
QR-платежу физлица (см. §2.5), и (б) даже там, где hold документирован (Alifpay), он привязан к
токену карты, а не к QR-платежу «оплата один раз без сохранения карты» — DoruTJ обязан
реализовать escrow **как собственный ledger поверх одностадийных платежей**, независимо от того,
подтвердит ли конкретный банк позже нативный hold/capture. Это также лучше соответствует
паттерну Wildberries/Uzum (§5.2: отложенный payout, а не банковский hold).

### 6.1 Принцип
Провайдер списывает деньги с клиента **сразу и полностью** (одностадийный платёж — capture
происходит на стороне банка немедленно после `PAID`/`SUCCEEDED`). DoruTJ не переводит деньги
аптеке немедленно, а держит их на **внутреннем escrow-балансе** (бухгалтерская запись в БД,
не физический счёт) до момента, когда заказ признан доставленным (OTP курьера, CUJ-4), либо до
автоматического возврата по таймауту.

### 6.2 Таблицы ledger (расширение схемы Charter §3, поверх `orders`)

```sql
CREATE TYPE escrow_entry_type AS ENUM (
  'hold_created',      -- деньги списаны у клиента, зачислены на escrow-баланс DoruTJ
  'capture_scheduled',  -- доставка подтверждена OTP, назначен payout
  'captured_to_pharmacy', -- средства реально переведены аптеке (payout job выполнен)
  'refunded_to_customer', -- возврат клиенту (отмена/SLA/спор)
  'partially_refunded',
  'adjustment'          -- ручная корректировка (только super_admin, с обоснованием)
);

CREATE TABLE escrow_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id),
    entry_type escrow_entry_type NOT NULL,
    amount_dirams BIGINT NOT NULL,          -- целые дирамы, см. Charter §5
    provider_transaction_id VARCHAR(255),   -- id платежа/рефанда у банка
    idempotency_key VARCHAR(255) NOT NULL UNIQUE, -- защита от дублей при ретраях вебхука/job
    created_by VARCHAR(50) NOT NULL,        -- 'webhook' | 'system_job' | 'admin:<user_id>'
    reason TEXT,                            -- обязателен для 'adjustment'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payout_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
    pharmacy_chain_id UUID NOT NULL REFERENCES pharmacy_chains(id),
    amount_dirams BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|due|paid|failed|reversed
    due_at TIMESTAMPTZ NOT NULL,             -- delivered_at + hold_period (см. 6.4)
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Баланс аптеки/сети в любой момент = `SUM(escrow_ledger.amount_dirams)` с фильтром по
`order_id IN (аптеки сети)` — классическая append-only бухгалтерская книга, не UPDATE
существующих строк (аудит и реконсиляция становятся тривиальными SQL-запросами).

### 6.3 Состояния заказа и таймауты (расширяет `order_status` из tz.log/Charter)

```
pending_payment
   │  webhook PAID/SUCCEEDED (подписан HMAC, идемпотентный) в течение payment_timeout (напр. 15 мин)
   ▼
paid_escrow  ──────────────────────────────────────────────┐
   │  фармацевт не начал сборку за pickup_sla (7 мин, tz.log)│ auto: PENDING > 15 мин →
   ▼                                                         │ order → cancelled,
processing (SLA сборки = 7 минут, таймер в терминале)        │ escrow_ledger: refunded_to_customer
   │  таймаут сборки истёк без "Передано курьеру"            │ (нужен provider refund call)
   ▼                                                         │
picked_up (courier) ──────────────────────────────────────┘
   │  курьер не доставил за delivery_sla (например 4 часа) →
   │  auto: escалация оператору, НЕ автосписание в пользу аптеки без подтверждения
   ▼
delivered (OTP клиента подтверждён курьером, CUJ-4)
   │  payout_schedule.due_at = delivered_at + hold_period_days
   ▼
captured_to_pharmacy (payout job выполнил перевод аптеке через банк/выписку)
```

Ключевые таймауты (значения по умолчанию — ASSUMPTION, требуют утверждения продуктом/финансами):
- `payment_timeout` = 15 минут с создания счёта до webhook `PAID` → иначе заказ `cancelled`,
  счёт у банка истекает сам (см. `timeout` в Alifpay `/invoice`, §2.2).
- `pickup_sla` = 7 минут (уже задано в tz.log, Модуль 5).
- `delivery_sla` = ASSUMPTION, например 4 часа в черте города / 24 часа для удалённых районов —
  требует утверждения (открытый вопрос §см. ниже).
- `hold_period_days` = ASSUMPTION, например **T+1 рабочий день** после `delivered` для оплаты
  наличными курьеру (эскроу не нужен — деньги у аптеки нет вообще, см. 6.5) и **T+2..T+3 дня**
  для безналичной предоплаты (аналог буфера Uzum Market на банковские нерабочие дни, §5.2) —
  обеспечивает окно на обработку споров/возвратов до необратимой выплаты аптеке.
- `dispute_window_days` = ASSUMPTION, например 24 часа после `delivered`, в течение которых
  клиент может открыть спор через поддержку и заморозить `payout_schedule.status`.

### 6.4 Автоматический refund по SLA
Фоновый job (`worker`, BullMQ, Charter §3.1) каждые N минут:
1. Находит заказы `pending_payment` старше `payment_timeout` → помечает `cancelled`
   (деньги не списаны — нечего возвращать).
2. Находит заказы `paid_escrow`, у которых аптека не начала сборку за `pickup_sla + буфер` →
   инициирует `PaymentProvider.refund()` на полную сумму, статус заказа → `cancelled`,
   `escrow_ledger` пишет `refunded_to_customer` с `idempotency_key = order_id + ':auto_refund'`.
3. Находит `payout_schedule` со статусом `pending`, у которых `due_at <= now()` и нет открытого
   спора → переводит в `due`, выполняет фактическую выплату аптеке (через её мерчант-счёт,
   Charter §3.4 «деньги тенанта идут напрямую» — для White-Label; для нейтрального DoruTJ —
   через внутренний перевод/выписку), пишет `captured_to_pharmacy`.
4. Ретраи payout с exponential backoff и ограничением попыток (`attempts`), после исчерпания —
   алерт на оператора (не должно копиться "зависших" выплат молча).

### 6.5 Особый случай: оплата наличными курьеру
tz.log упоминает `payment_method` включая потенциально `cash_courier` (аналогия с колонкой
`payment_method VARCHAR(50)` в §II.2 tz.log, значение `'cash_courier'` явно в комментарии). Для
такого заказа эскроу-леджер не нужен вообще — деньги никогда не проходят через DoruTJ. Комиссия
платформы с аптеки в этом случае — отдельный B2B биллинг (вне скоупа данного документа,
пересекается с исследованием White-Label/финансовой модели).

### 6.6 Реконсиляция (сверка)
- Ежедневная (или чаще) job сверяет: (a) сумму по `escrow_ledger` за период vs (b) выписку/отчёт
  банка по транзакциям за тот же период (если провайдер отдаёт `GET /transactions?date=`-подобный
  отчётный эндпоинт — уточнить у каждого банка отдельно, не подтверждено ни для одного из них
  публично).
- Расхождения (заказ помечен `paid_escrow`, но нет ответной строки в банковской выписке, и
  наоборот) → отдельная таблица `reconciliation_discrepancies` с обязательным ручным разбором,
  **не** автоматическим изменением статуса заказа.
- Для рефандов, зависших в `FAILED` без причины (подтверждено для Alifpay, §2.6) — обязателен
  ручной процесс эскалации в банк, т.к. текстовая причина отказа не гарантирована.

---

## 7. Целевой интерфейс `PaymentProvider`

Ниже — контракт для `packages/contracts` (Zod-схемы, Charter §3.1), реализуемый
`AlifMobiProvider`, `DcNextProvider`, `MockBankProvider` (и потенциально позже
`SmartpayAggregatorProvider`, если переговоры подтвердят единый контракт агрегатора, §3.6).

### 7.1 Методы

```ts
interface PaymentProvider {
  /** Человекочитаемый идентификатор адаптера, для логов/метрик. */
  readonly providerId: 'alif_mobi' | 'dc_next' | 'mock_bank'; // расширяется через enum в contracts

  /**
   * Создать счёт на оплату (аналог Alifpay /invoice). Идемпотентно по orderId:
   * повторный вызов с тем же orderId обязан вернуть тот же billId, а не создавать дубль.
   */
  createBill(input: {
    orderId: string;               // UUID заказа DoruTJ — тоже используется как idempotencyKey
    amountDirams: bigint;          // целые дирамы (Charter §5), конвертация в единицы банка — внутри адаптера
    currency: 'TJS';
    payoutAccountRef?: string;     // tin/inn аптеки или мерчант-id для White-Label сплита (см. §2.2)
    customerPhone: string;         // E.164 или локальный формат — нормализуется в адаптере
    webhookUrl: string;            // HTTPS callback, фиксированный per-tenant
    expiresInSec: number;          // = payment_timeout (§6.3)
    metadata?: Record<string, string>;
  }): Promise<{
    billId: string;                // provider-side id счёта
    qrPayload?: string;            // сырой payload для рендера QR, если провайдер его отдаёт
    qrImageUrl?: string;           // готовая ссылка на картинку QR, если провайдер рендерит сам
    deeplinkUrl?: string;          // ссылка "открыть в приложении банка"
    redirectUrl?: string;          // fallback: страница оплаты в браузере
    expiresAt: string;             // ISO-8601
  }>;

  /** Явный опрос статуса счёта — используется реконсиляцией и как fallback, если вебхук не пришёл. */
  getBillStatus(billId: string): Promise<{
    status: 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled';
    providerTransactionId?: string;
    paidAmountDirams?: bigint;
    rawProviderStatus: string;     // сырой код провайдера (SUCCEEDED/DECLINED/... — для логов)
  }>;

  /**
   * Двухстадийная оплата, ЕСЛИ провайдер её поддерживает (см. §2.5 — под вопросом для QR-флоу).
   * MockBankProvider обязан реализовать честно, реальные адаптеры — throw UnsupportedOperationError,
   * если банк не подтвердил поддержку; вызывающий код (escrow-движок §6) не должен зависеть от
   * доступности этого метода и обязан работать через программный escrow в любом случае.
   */
  capturePreauth?(billId: string, amountDirams?: bigint): Promise<{ success: boolean }>;
  voidPreauth?(billId: string): Promise<{ success: boolean }>;

  /** Полный или частичный возврат. */
  refund(input: {
    billId: string;
    amountDirams: bigint;          // = полная сумма для полного возврата
    idempotencyKey: string;        // напр. `${orderId}:refund:${reasonCode}`
    reasonCode: 'sla_timeout' | 'customer_cancel' | 'dispute' | 'admin_adjustment';
  }): Promise<{
    refundId: string;
    status: 'done' | 'pending' | 'failed';
    rawProviderStatus: string;
  }>;

  /** Проверка подписи входящего вебхука. Выполняется до десериализации бизнес-полей. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean;

  /** Парсинг вебхука в единый внутренний формат события. */
  parseWebhookEvent(rawBody: Buffer): {
    billId: string;
    eventType: 'paid' | 'failed' | 'expired' | 'refunded' | 'unknown';
    providerTransactionId: string;
    amountDirams: bigint;
    occurredAt: string;
  };
}
```

### 7.2 Коды ошибок (в `packages/contracts`, единый формат Charter §5: `{error:{code,message,details?}}`)

```
PAYMENT_PROVIDER_UNAVAILABLE      -- банк недоступен (circuit breaker открыт, Charter §7)
PAYMENT_BILL_CREATION_FAILED
PAYMENT_BILL_EXPIRED
PAYMENT_INSUFFICIENT_FUNDS        -- маппится из INSUFFICIENT_FUNDS/1108 и т.п.
PAYMENT_CARD_BLOCKED_OR_EXPIRED   -- маппится из BLOCKED_CARD/EXPIRED_CARD/1103/1107
PAYMENT_OTP_REQUIRED              -- маппится из OTP_REQUIRED (если применимо к флоу)
PAYMENT_DECLINED_GENERIC          -- fallback для DECLINED/UNKNOWN_ERROR
PAYMENT_REFUND_FAILED_UNKNOWN_REASON -- специально для случая Alifpay FAILED без details (§2.6)
PAYMENT_WEBHOOK_SIGNATURE_INVALID -- HMAC не совпал — событие ИГНОРИРУЕТСЯ, не обрабатывается
PAYMENT_WEBHOOK_DUPLICATE         -- idempotency-key уже обработан, событие подтверждено 200, но не переисполняется
PAYMENT_PREAUTH_NOT_SUPPORTED     -- capturePreauth/voidPreauth не реализован адаптером
```

### 7.3 Идемпотентность
- Все mutating-методы (`createBill`, `refund`) принимают явный идемпотентный ключ (`orderId` или
  составной `${orderId}:${operation}`); адаптер обязан либо передать этот ключ провайдеру
  (если банк поддерживает клиентский `id`, как Alifpay `/hold`, §2.5), либо, если банк не
  поддерживает идемпотентность нативно, реализовать её локально: таблица `payment_operations`
  с UNIQUE(`idempotency_key`) и статусом `in_flight`/`done`/`failed`, чтобы повторный вызов из-за
  сетевого ретрая не создавал два счёта или два рефанда.
- Обработка вебхуков — обязательно через тот же `idempotency_key` в `escrow_ledger` (UNIQUE,
  §6.2): повторная доставка одного и того же события банка (в пределах его retry-окна, §2.7)
  не должна дублировать запись в леджере.

### 7.4 Circuit breaker и деградация (Charter §7)
- Если `PaymentProvider` недоступен (timeout/5xx) сверх порога ошибок — открыть circuit breaker
  для конкретного `providerId`, скрыть этот способ оплаты из checkout (но не ронять чекаут
  целиком — Charter поддерживает MockBank и потенциально несколько банковских адаптеров
  параллельно), логировать инцидент.

---

## Требования, вытекающие из исследования

1. **REQ-PAY-1**: Статус оплаты заказа переводится в `paid_escrow` исключительно обработчиком
   подписанного серверного вебхука провайдера; в кодовой базе не должно существовать ни одного
   UI-элемента, API-метода или БД-операции, позволяющих фармацевту/курьеру/оператору вручную
   выставить `paid_escrow` иначе как через отдельный `admin_payment_override` с ролью
   `super_admin`, обязательным `reason` и записью в audit log.
2. **REQ-PAY-2**: Каждый реальный адаптер `PaymentProvider` (`AlifMobiProvider`,
   `DcNextProvider`, ...) обязан проверять HMAC-подпись вебхука (`verifyWebhookSignature`) до
   любой десериализации бизнес-полей тела запроса; несовпадение подписи — событие отбрасывается
   с логом `PAYMENT_WEBHOOK_SIGNATURE_INVALID`, статус заказа не меняется.
3. **REQ-PAY-3**: Обработка вебхука идемпотентна: повторная доставка одного и того же события
   (тот же `provider_transaction_id`/`idempotency_key`) не создаёт вторую запись в
   `escrow_ledger` и не выполняет побочные эффекты повторно; обработчик обязан отвечать `200`
   до истечения окна ретраев провайдера (ориентир — 1 час по документации Alifpay, §2.7),
   выполняя тяжёлую бизнес-логику асинхронно после быстрой записи события.
4. **REQ-PAY-4**: Escrow реализуется как программный ledger DoruTJ (`escrow_ledger`,
   `payout_schedule`) поверх одностадийных (списание сразу) платежей — система не должна
   architecturally зависеть от нативной поддержки hold/capture конкретным банком, даже если
   такая поддержка появится и будет использоваться как оптимизация.
5. **REQ-PAY-5**: Для каждого заказа со статусом `paid_escrow`, у которого не произошёл переход
   в `processing` (аптека начала сборку) в течение `pickup_sla` + сконфигурированный буфер,
   фоновый job обязан инициировать `PaymentProvider.refund()` на полную сумму и перевести заказ
   в `cancelled`; отсутствие ответа от банка на рефанд в течение N попыток — алерт оператору,
   заказ не считается автоматически возвращённым до подтверждения.
6. **REQ-PAY-6**: Выплата аптеке (`captured_to_pharmacy`) не выполняется раньше, чем через
   `hold_period_days` после статуса `delivered`, и блокируется, если по заказу открыт активный
   спор (`dispute_window_days`); оба параметра конфигурируемы per-tenant (Charter §3.4
   White-Label — сети получают деньги напрямую на свой мерчант-счёт, для них
   `payout_schedule` вырождается в уведомление, а не в реальный перевод DoruTJ).
7. **REQ-PAY-7**: Все денежные суммы в контракте `PaymentProvider` и в `escrow_ledger` передаются
   и хранятся в целых дирамах (`bigint`/`int`, не `float`), конвертация в единицы конкретного
   банка (тийин/др.) выполняется внутри соответствующего адаптера и нигде за его пределами.
8. **REQ-PAY-8**: `createBill` и `refund` идемпотентны по явному ключу; если провайдер не
   поддерживает клиентский идемпотентный идентификатор нативно, идемпотентность обеспечивается
   локальной таблицей `payment_operations` (UNIQUE по ключу) до вызова внешнего API.
9. **REQ-PAY-9**: Реализуется ежедневная (минимум) job реконсиляции, сверяющая
   `escrow_ledger` с отчётом/статусами провайдера по `getBillStatus`; расхождения пишутся в
   `reconciliation_discrepancies` и требуют ручного разбора, статус заказа не меняется
   реконсиляцией автоматически.
10. **REQ-PAY-10**: Метод `capturePreauth`/`voidPreauth` в интерфейсе `PaymentProvider`
    объявлен опциональным (`?`); вызывающий код escrow-движка не имеет права требовать его
    наличия — вся бизнес-логика эскроу обязана работать корректно и при отсутствии нативного
    hold у банка (см. REQ-PAY-4).
11. **REQ-PAY-11**: При получении от провайдера отказа рефанда без указания причины
    (задокументированное поведение Alifpay, `FAILED` без деталей, §2.6) система обязана создать
    задачу ручной эскалации, а не повторять запрос бесконечно молча и не помечать заказ как
    успешно возвращённый.
12. **REQ-PAY-12**: UI checkout обязан скрывать способ оплаты конкретного провайдера, если для
    него открыт circuit breaker (провайдер недоступен по факту таймаутов/5xx выше порога), не
    показывая пользователю технические ошибки банка напрямую.
13. **REQ-PAY-13**: Каждый мутирующий вызов к `PaymentProvider` и каждая запись в
    `escrow_ledger` логируются структурно (pino, `requestId`, `tenantId`, `orderId`,
    `providerId`) без хардкода сумм/токенов карт в открытом виде в логах (секреты/PAN — маскируются).
14. **REQ-PAY-14**: Способ оплаты `cash_courier` не создаёт записей в `escrow_ledger` /
    `payout_schedule` — комиссия платформы с аптеки для наличных заказов ведётся отдельным
    B2B-биллингом вне эскроу-движка.

---

## Открытые вопросы

1. Какой из провайдеров (Alif Mobi, DC Next, Humo, Amonatbonk) реально готов подписать
   коммерческий договор и выдать тестовые API-ключи/песочницу к моменту разработки — от этого
   зависит, какой адаптер реализуется первым как «настоящий», а какие остаются заглушками за
   интерфейсом (Charter допускает работу полностью на `MockBankProvider`, но для реального
   запуска нужен хотя бы один живой контракт).
2. Действительно ли Alif Bank TJ (Alif Mobi) использует тот же API-контракт, что и Alifpay
   (Узбекистан), либо это полностью независимая кодовая база с другими эндпоинтами — требует
   прямого запроса в Alif Bank TJ (`support@alif.tj`).
3. Поддерживает ли QR-флоу оплаты через приложение Alif Mobi (`MOBI_SHOW_QR`) двухстадийный
   hold/capture, или hold доступен только для сохранённых токенов карт (§2.5) — критично для
   решения, полагаться ли вообще на банковский hold как на оптимизацию поверх программного
   escrow.
4. Какова точная техническая спецификация «единого QR» НБТ 2023 года (если она вообще
   опубликована регулятором отдельным документом) — стоит запросить напрямую у НБТ / Агентства
   по инновациям и цифровым технологиям РТ.
5. Требуется ли DoruTJ (как оператору, временно держащему на своём ledger деньги клиентов до
   выплаты аптекам) отдельная лицензия/регистрация как платёжная организация по Закону РТ
   №1397 «О платёжных услугах и платёжной системе», или достаточно того, что физически деньги
   всегда лежат на счетах банка-эквайера, а DoruTJ ведёт только учётный (не расчётный) ledger —
   требует юридической консультации, выходит за рамки технического исследования.
6. Каковы реальные значения `pickup_sla`-буфера, `delivery_sla`, `hold_period_days`,
   `dispute_window_days` (все помечены ASSUMPTION в §6.3) — должны быть утверждены продуктом и
   финансовым блоком до реализации автоматического рефанда/выплаты, слишком короткий SLA
   создаёт риск ложных возвратов при обычных задержках курьера.
7. Какие банки реально выступают Visa/Mastercard-эквайерами для сторонних интернет-магазинов
   (не только для собственных клиентов банка) — ни на одном сайте не найдено прямого
   подтверждения готовности обслуживать внешний e-commerce маркетплейс; это стоит выяснить на
   этапе коммерческих переговоров параллельно с Alif/DC.
8. Стоит ли делать ставку на Smartpay.tj как единого агрегатора вместо 3–4 отдельных банковских
   адаптеров — зависит от того, подтвердит ли Smartpay публичный/тестовый доступ к своему API
   (не найден публично на момент исследования) и от коммерческих условий.
9. Как технически провайдер отдаёт отчёт/выписку транзакций за период (для реконсиляции,
   §6.6) — ни один банк не документирует такой эндпоинт публично; вероятно, потребуется либо
   ручная выгрузка из личного кабинета банка, либо отдельный запрос при подписании договора.
