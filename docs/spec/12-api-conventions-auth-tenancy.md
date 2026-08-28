# DoruTJ — Конвенции API, аутентификация, RBAC, мультитенантность

> Владелец: Analyst (SRS). Статус: **BASELINE для фазы Analysis**.
> Приоритет источников при противоречии: `03-ARCHITECT-DECISIONS.md` (D-*) > `00-PROJECT-CHARTER.md`
> (CUJ-*, §) > `research/00-RESEARCH-DIGEST.md` (REQ-*) > `tz.log` (§ТЗ). Этот документ обязателен
> для `10-domain-model.md` в части ошибок (расширяет `DomainExceptionFilter`), политик (`02` §3.4:
> «авторизация — политика в application, в guard'ах — только аутентификация и грубая проверка роли»)
> и доменных событий (§6 ниже переиспользует таблицу событий `10-domain-model.md` «Доменные события»
> как источник правды для payload).
>
> Слои — по `02-CLEAN-ARCHITECTURE-AND-CODE.md`.Guard'ы (`AuthGuard`, `TenantResolutionGuard`,
> `RolesGuard`) — **presentation**. Политики владения/условной авторизации (`OrderPolicy`,
> `PrescriptionAccessPolicy`, `DisputeAuthorizationPolicy`) — **application**. `AuthSession`, `User`,
> `OtpCode` (уже определён в `10-domain-model.md` §4 «Value Objects») — **domain** контекста `identity`.
> Провайдеры (`SmsProvider`, `TelegramAuthProvider`) — **infrastructure**.
>
> Идентификаторы требований: **SRS-API-nnn**. Тестовые сценарии: **TC-API-nnn**.

---

## Глоссарий (термины этого документа)

| Термин | Определение |
|---|---|
| Envelope | Обёртка HTTP-ответа: `{ data, meta? }` для успеха, `{ error }` для ошибки (§2). |
| Principal | Аутентифицированный субъект запроса: человек (`User` + роль) ИЛИ система (`pharmacy_system` по `X-Pharmacy-API-Key`, `bank_webhook` по HMAC банка). RBAC-матрица §4 покрывает только человеческие роли. |
| Permission string | Строка вида `<resource>:<action>[:<scope>]`, например `orders:cancel:own`, `disputes:resolve_partial:any`. |
| Room | WS-канал подписки в `/api/v1/realtime`, скоуп по роли/сущности (`pharmacy:{id}`, `courier:{id}`). |
| Тенант-скоуп | См. `10-domain-model.md` глоссарий — обязательный `tenant_id`/`chain_id`-фильтр репозитория. |

---

## 1. Конвенции REST API

**SRS-API-001** [Charter §3.6.2] Все продуктовые эндпоинты — под префиксом `/api/v1`. Мажорная
несовместимая смена контракта увеличивает версию (`/api/v2`), обе версии сосуществуют минимум один
релизный цикл. Минорные аддитивные изменения (новое опциональное поле) версию не меняют.

**SRS-API-002** Именование ресурсов — существительные во множественном числе, `kebab-case` для
составных слов: `/orders`, `/order-returns`, `/pharmacy-accounts`, `/inventory-sync-batches`.
Вложенность — не глубже 2 уровней от корня предметной сущности:
`/orders/:orderId/items` — да; `/pharmacies/:id/orders/:orderId/items/:itemId/refunds` — нет
(переносится в `/order-item-refunds?orderItemId=`). Идентификатор в пути — всегда `UUID` (кроме
`GET /api/v1/i18n/:locale`, где `:locale ∈ {tj,ru,en}`).

**SRS-API-003** Глаголы действий, не являющихся CRUD, — под ресурсом как под-путь с глаголом в
инфинитиве: `POST /api/v1/orders/:id/cancel`, `POST /api/v1/disputes/:id/resolve-reject`,
`POST /api/v1/pharmacy-accounts/:id/activate`. Имя под-пути 1:1 совпадает с именем метода-намерения
сущности домена (`order.cancel()` → `/cancel`), чтобы presentation оставался тонким мапиром.

### 1.1 Пагинация (cursor-based)

**SRS-API-004** Все списковые эндпоинты (`GET /api/v1/orders`, `/medicines`, `/inventory-sync-batches`
и т.д.) пагинируются курсором, НЕ `offset/page`: offset-пагинация на таблицах с частыми вставками
(`orders`, `inventory_sync_batches`) даёт дубли/пропуски строк при сдвиге курсора между запросами.

Запрос: `GET /api/v1/orders?cursor=<opaque>&limit=20&sort=createdAt:desc`.

- `limit`: `1..100`, дефолт `20`. `limit=101` → `400 VALIDATION_ERROR` (не молчаливое обрезание).
- `cursor`: непрозрачная строка `base64url(JSON.stringify({ v: sortFieldValue, id }))`, кодирует
  значение поля сортировки и `id` последней строки предыдущей страницы (keyset pagination).
  Отсутствует на первой странице.

Ответ:

```json
{
  "data": [ { "id": "...", "orderNumber": "DTJ-260827-00001", "...": "..." } ],
  "meta": {
    "pagination": { "nextCursor": "eyJ2IjoiMjAyNi0wOC0yN1QxMjowMDowMFoiLCJpZCI6Ii4uLiJ9", "hasMore": true, "limit": 20 }
  }
}
```

**SRS-API-005** Given курсор декодируется в структуру с полем `v`, не совпадающим по типу с
объявленным `sort`-полем эндпоинта (например, число вместо ISO-даты), When эндпоинт обрабатывает
запрос, Then возвращается `400 INVALID_CURSOR` — курсор не подгоняется под тип принудительно.

### 1.2 Сортировка и фильтрация

**SRS-API-006** `sort=field:asc|desc`, несколько полей через запятую: `sort=price:asc,createdAt:desc`.
Разрешённые поля сортировки объявлены явным `enum` в Zod-схеме query каждого эндпоинта
(`packages/contracts`); поле вне списка → `400 VALIDATION_ERROR`, деталь `details.field='sort'`.

**SRS-API-007** Фильтрация — `filter[<field>]=<value>` (сокращение для `eq`) или
`filter[<field>][<op>]=<value>`, `op ∈ {eq,ne,gt,gte,lt,lte,in,like}`. Значение `in` — список через
запятую: `filter[status][in]=paid_escrow,processing`. Диапазон цены:
`filter[priceDiram][gte]=1000&filter[priceDiram][lte]=5000`. Список допустимых полей и операторов на
поле — часть Zod query-схемы эндпоинта (не общий парсер «любое поле любой таблицы» — иначе утечка
внутренней модели БД в контракт, `02` §1.1).

### 1.3 Формат дат

**SRS-API-008** [Charter §5, D-04] Все временные метки в JSON — ISO 8601 UTC с суффиксом `Z`
(`"2026-08-27T09:15:00.000Z"`), без исключений на входе и выходе. Бизнес-даты, требующие календарного
дня (`OrderNumber` §`SRS-DOM-085`, ночная синхронизация 03:00, `INVENTORY_DELTA_SLA_MINUTES`), считаются
от UTC-момента, конвертированного в `Asia/Dushanbe` (`UTC+5`, без перехода на летнее время) ИСКЛЮЧИТЕЛЬНО
на границе `infrastructure` (`ClockPort.nowInTenantTz()`), никогда в `domain` (`02` §2.6). Чистые даты
без времени (`expiry_date`) — `"YYYY-MM-DD"`, без таймзоны, сравнение — лексикографическое.

### 1.4 Идемпотентность

**SRS-API-009** Заголовок `Idempotency-Key` (клиентский UUID v4) ОБЯЗАТЕЛЕН для эндпоинтов, создающих
финансовый/операционный побочный эффект при повторной отправке (двойной тап, ретрай сети):

| Эндпоинт | Почему обязателен |
|---|---|
| `POST /api/v1/orders` (checkout) | Двойной заказ = двойное списание/резерв (SRS-DOM-166: ключ на попытку — `checkout_attempt_id`, реализуется как `Idempotency-Key`) |
| `POST /api/v1/prescriptions` (загрузка) | Двойной запуск OCR-джобы на одно фото |
| `POST /api/v1/order-returns` | Двойной возвратный рейс |
| `POST /api/v1/disputes/:id/resolve-*` | Двойное списание/рефанд по спору |
| `POST /api/v1/delivery-assignments/:id/record-cash` | Двойная фиксация наличных |
| `POST /api/v1/pharmacy-accounts/:id/api-keys/:keyId/rotate` | Двойная ротация ключа 1С |

Отсутствие заголовка на этих эндпоинтах → `400 IDEMPOTENCY_KEY_REQUIRED`. На остальных мутирующих
эндпоинтах заголовок опционален, но если передан — обрабатывается по тем же правилам (SRS-API-010).

**SRS-API-010** Given `Idempotency-Key = K` уже сохранён для `(userId, endpoint)` с ЗАВЕРШЁННЫМ
ответом, When повторный запрос с тем же `K` И тем же телом (сравнение по `sha256(body)`), Then
возвращается СОХРАНЁННЫЙ ответ (тот же HTTP-статус и тело) БЕЗ повторного выполнения use case. Given
тот же `K`, но тело отличается (`sha256` не совпадает), Then `409 IDEMPOTENCY_KEY_CONFLICT`. Given
запрос с `K` ещё обрабатывается (конкурентный дубль, гонка), Then второй запрос немедленно получает
`409 IDEMPOTENCY_KEY_CONFLICT` (не блокируется в ожидании первого) — клиент обязан ретраить с
backoff, к этому моменту первый запрос уже завершён и вернёт кэш. Хранение: таблица
`idempotency_keys(user_id, endpoint, key, request_hash, status, response_status, response_body,
created_at)`, TTL `IDEMPOTENCY_KEY_TTL_HOURS` (ASSUMPTION 24), `UNIQUE(user_id, endpoint, key)`.

Отдельно: идемпотентность вебхука банка (`payment_operations.idempotency_key`, REQ-PAY-3,
SRS-DOM-164) — ДРУГОЙ механизм (server-to-server, ключ из тела вебхука, не заголовок
`Idempotency-Key`); не путать эти два уровня.

### 1.5 Заголовки запроса

| Заголовок | Обязателен | Назначение |
|---|---|---|
| `Authorization: Bearer <JWT>` | Да, кроме публичных эндпоинтов (§4, §7) | Аутентификация человека |
| `X-Request-Id` | Нет (генерируется сервером, если отсутствует) | Сквозная трассировка, попадает в pino-лог (Charter §5) |
| `Accept-Language` | Нет (дефолт `tj`, D-19/Charter i18n) | `tj`/`ru`/`en` — влияет на `error.message` и `meta.locale`-зависимые поля |
| `X-Tenant-Slug` | Нет (см. §5, участвует в резолвинге тенанта) | Явное указание тенанта, когда `Host` не резолвится |
| `Idempotency-Key` | Условно (SRS-API-009) | Дедупликация мутаций |
| `X-Pharmacy-API-Key` / `X-Pharmacy-Timestamp` / `X-Pharmacy-Nonce` / `X-Pharmacy-Signature` | Да для 1С-канала (§3.6) | Аутентификация системного принципала `pharmacy_system` |

**SRS-API-011** `X-Request-Id`, если передан клиентом, ДОЛЖЕН быть `UUID`; сервер принимает как есть
для сквозной трассировки клиент→бэкенд, но генерирует собственный `requestId` для внутренних логов,
если клиентский невалиден (не `500` из-за плохого заголовка трассировки).

### 1.6 Rate limiting

**SRS-API-012** [Charter, `@fastify/rate-limit` + Redis store] Лимиты — двухуровневые: глобальный
дефолт на инстанс + переопределение per-route декоратором `@RateLimit({ max, windowSec, keyBy })`.

| Область | Лимит (ASSUMPTION, конфигурируется ENV) | Ключ |
|---|---|---|
| Глобальный дефолт, анонимный | `RATE_LIMIT_ANON_PER_MIN = 100` | IP |
| Глобальный дефолт, аутентифицированный | `RATE_LIMIT_USER_PER_MIN = 300` | `userId` |
| `POST /api/v1/auth/otp/request` | см. §3.1 (специфичный, ниже общего) | `phone` + вторично `IP` |
| `POST /api/v1/auth/otp/verify` | см. §3.1 | `otpRequestId` |
| `POST /api/v1/inventory/batch-update` | `RATE_LIMIT_1C_BATCH_PER_MIN = 20` (REQ-SYNC-4/D-05: 500/сек устойчиво агрегируется батчами, не построчными HTTP-вызовами) | `pharmacyId` |

**SRS-API-013** Ответ при превышении — `429` с телом `{ error: { code: 'RATE_LIMITED', ... } }` и
заголовками `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (unix-время сброса
окна), `Retry-After` (секунды). Заголовки `X-RateLimit-*` присутствуют на КАЖДОМ ответе
лимитируемого маршрута, не только при 429 — клиент может проактивно снижать частоту.

---

## 2. Единый формат ответа и ошибок

**SRS-API-014** [Charter §5] Успешный ответ — всегда `{ "data": ..., "meta"?: {...} }`. `data` —
объект для единичного ресурса, массив для коллекции (обёрнутый `meta.pagination`, SRS-API-004).
Пустое успешное действие без возвращаемого ресурса (`204`-подобные операции, например
`POST /api/v1/auth/logout`) возвращает `{ "data": { "success": true } }` со статусом `200` — НЕ
`204 No Content` (пустое тело осложняет единообразный клиент, генерируемый из OpenAPI).

**SRS-API-015** Ошибка — всегда `{ "error": { "code": "SCREAMING_SNAKE", "message": "...", "details"?: {...} } }`.
`message` — локализован по `Accept-Language` (`tj` по умолчанию). `details` — структурированный объект
для программной обработки клиентом (например, `{ "field": "phone" }` для `VALIDATION_ERROR`), НИКОГДА
не содержит stack trace в production (`NODE_ENV=production` → `details` для `500 INTERNAL_ERROR`
принудительно опускается, только `requestId` для связи с логом сервера).

**SRS-API-016** Маппинг ошибка → HTTP-код происходит в ЕДИНОМ месте: `DomainExceptionFilter`
(доменные ошибки, полный список — `10-domain-model.md` §«Доменные ошибки») +
`TransportExceptionFilter` (ошибки этого документа: аутентификация, тенантность, транспорт, ниже).
Оба фильтра регистрируются глобально (`APP_FILTER`), ни один контроллер не содержит собственного
`try/catch` с ручным маппингом кода (`02` §4 C12, дублирует SRS-DOM-153).

### 2.1 Каталог кодов ошибок (расширение поверх `10-domain-model.md`)

> Домен-специфичные коды (`PRESCRIPTION_NOT_VERIFIED`, `OTP_EXPIRED`, `INSUFFICIENT_STOCK` и т.д.) —
> см. `10-domain-model.md` §«Доменные ошибки», не дублируются здесь. Ниже — коды транспортного/
> auth/tenancy уровня, специфичные для ЭТОГО документа. Все коды — enum `ErrorCode` в
> `packages/contracts/src/errors.ts`, единый источник для TS и (через OpenAPI, §8) для Dart.

| Code | HTTP | RU | TJ | EN |
|---|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Некорректные данные запроса | Маълумоти дархост нодуруст аст | Invalid request data |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Требуется заголовок Idempotency-Key | Сарлавҳаи Idempotency-Key лозим аст | Idempotency-Key header is required |
| `INVALID_CURSOR` | 400 | Некорректный курсор пагинации | Курсори саҳифабандӣ нодуруст аст | Invalid pagination cursor |
| `TENANT_NOT_RESOLVED` | 400 | Не удалось определить тенанта запроса | Тенанти дархост муайян нашуд | Could not resolve request tenant |
| `CONSENT_REQUIRED` | 400 | Требуется явное согласие пользователя | Розигии кушоди корбар лозим аст | Explicit user consent required |
| `UNAUTHENTICATED` | 401 | Требуется вход в систему | Бояд ворид шавед | Authentication required |
| `TOKEN_EXPIRED` | 401 | Токен доступа истёк, обновите сессию | Токени дастрасӣ мӯҳлаташ гузаштааст | Access token expired |
| `TOKEN_INVALID` | 401 | Токен доступа недействителен | Токени дастрасӣ беэътибор аст | Access token is invalid |
| `REFRESH_TOKEN_INVALID` | 401 | Refresh-токен недействителен или отозван | Refresh-токен беэътибор ё бекоршуда | Refresh token invalid or revoked |
| `REFRESH_TOKEN_REUSE_DETECTED` | 401 | Обнаружено повторное использование refresh-токена, все сессии завершены | Истифодаи такрории refresh-токен ошкор шуд, ҳама сессияҳо қатъ шуданд | Refresh token reuse detected, all sessions revoked |
| `INVALID_TELEGRAM_INIT_DATA` | 401 | Подпись Telegram initData недействительна | Имзои Telegram initData беэътибор аст | Invalid Telegram initData signature |
| `TELEGRAM_AUTH_DATE_EXPIRED` | 401 | Сессия Telegram устарела, откройте приложение заново | Сессияи Telegram кӯҳна шуд, барномаро аз нав кушоед | Telegram session expired, reopen the app |
| `PHARMACY_API_KEY_INVALID` | 401 | Недействительный ключ доступа аптеки | Калиди дастрасии дорухона беэътибор аст | Invalid pharmacy API key |
| `PHARMACY_SIGNATURE_INVALID` | 401 | Недействительная подпись запроса | Имзои дархост беэътибор аст | Invalid request signature |
| `PHARMACY_TIMESTAMP_OUT_OF_WINDOW` | 401 | Метка времени запроса вне допустимого окна | Мӯҳлати вақти дархост берун аз доира | Request timestamp outside allowed window |
| `PHARMACY_REQUEST_REPLAYED` | 401 | Запрос уже был обработан (повтор nonce) | Дархост аллакай коркард шудааст | Request already processed (nonce replay) |
| `MTLS_REQUIRED` | 401 | Для этой аптеки требуется mTLS-сертификат | Барои ин дорухона сертификати mTLS лозим аст | mTLS certificate required for this pharmacy |
| `INVALID_WEBHOOK_SIGNATURE` | 401 | Недействительная подпись вебхука | Имзои webhook беэътибор аст | Invalid webhook signature |
| `FORBIDDEN` | 403 | Действие запрещено для вашей роли | Амал барои нақши шумо иҷозат дода нашудааст | Action forbidden for your role |
| `INSUFFICIENT_ROLE` | 403 | Недостаточно прав для этого действия | Ҳуқуқ барои ин амал кофӣ нест | Insufficient permissions for this action |
| `TENANT_SUSPENDED` | 403 | Тенант приостановлен | Тенант муваққатан боздошта шудааст | Tenant is suspended |
| `CROSS_TENANT_ACCESS_DENIED` | 403 | Доступ к данным другого тенанта запрещён | Дастрасӣ ба маълумоти тенанти дигар манъ аст | Cross-tenant data access denied |
| `WS_ROOM_FORBIDDEN` | 403 | Подписка на этот канал запрещена | Обуна ба ин канал иҷозат дода нашудааст | Subscription to this channel is forbidden |
| `NOT_FOUND` | 404 | Ресурс не найден | Захира ёфт нашуд | Resource not found |
| `UNKNOWN_TENANT_SLUG` | 404 | Тенант с таким идентификатором не найден | Тенант бо ин рамз ёфт нашуд | No tenant with this slug |
| `UNSUPPORTED_LOCALE` | 404 | Язык не поддерживается | Забон дастгирӣ намешавад | Locale not supported |
| `REQUEST_TIMEOUT` | 408 | Превышено время ожидания запроса | Мӯҳлати интизории дархост гузашт | Request timeout exceeded |
| `CONFLICT` | 409 | Конфликт состояния ресурса | Низои ҳолати захира | Resource state conflict |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Ключ идемпотентности уже используется с другим телом запроса или ещё обрабатывается | Калиди идемпотентӣ аллакай истифода мешавад | Idempotency key already in use with a different body or still processing |
| `PAYLOAD_TOO_LARGE` | 413 | Размер тела запроса превышен | Ҳаҷми дархост аз ҳад зиёд аст | Request body too large |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Неподдерживаемый формат содержимого | Формати маълумот дастгирӣ намешавад | Unsupported content type |
| `BUSINESS_RULE_VIOLATION` | 422 | Нарушено бизнес-правило | Қоидаи корӣ вайрон шуд | Business rule violated |
| `OTP_LOCKED` | 423 | Слишком много неверных попыток, код заблокирован | Кӯшишҳои зиёди нодуруст, рамз баста шуд | Too many wrong attempts, code locked |
| `OTP_REQUEST_RATE_LIMITED` | 429 | Слишком много запросов кода, попробуйте позже | Дархостҳои зиёди рамз, баъдтар кӯшиш кунед | Too many code requests, try again later |
| `RATE_LIMITED` | 429 | Слишком много запросов | Дархостҳои зиёд | Too many requests |
| `INTERNAL_ERROR` | 500 | Внутренняя ошибка сервера | Хатои дохилии сервер | Internal server error |
| `BAD_GATEWAY` | 502 | Ошибка внешнего сервиса | Хатои хизмати беруна | Upstream service error |
| `SERVICE_UNAVAILABLE` | 503 | Сервис временно недоступен | Хизмат муваққатан дастнорас аст | Service temporarily unavailable |

> Переводы `tj` — предварительные (машинно-выверенные по лексике глоссария `10-domain-model.md`),
> подлежат вычитке носителем/фармацевтом перед продакшен-релизом (та же оговорка, что и в
> `10-domain-model.md` §«Глоссарий»).

---

## 3. Аутентификация

Контекст `identity` (`10-domain-model.md` §«Ограниченные контексты») владеет `User`, `AuthSession`.
Ниже — четыре независимых `AuthProvider` (Provider Pattern, Charter §3.3), все выпускают ОДИН формат
JWT (Charter §3.6.2/REQ-TG-2): OTP-по-телефону (человеческие роли), Telegram TWA `initData`, 1С
(`X-Pharmacy-API-Key`+HMAC — системный принципал, НЕ пользователь и НЕ JWT), Flutter-клиенты
переиспользуют OTP-провайдер (тот же Bearer JWT, Charter §3.6).

**SRS-API-017** [Charter, `identity`] `users.tenant_id` — `NOT NULL`, `UNIQUE(tenant_id, phone)`.
Аккаунт клиента создаётся В КОНТЕКСТЕ тенанта, через который произошла первая аутентификация (домен
`neutral` или White-Label). Один и тот же номер телефона может иметь НЕЗАВИСИМЫЕ аккаунты в разных
тенантах (изоляция White-Label, Charter §3.4) — это не дубль, а разные строки `users`. Персонал
(`pharmacist`/`pharmacy_admin`) дополнительно несёт `pharmacy_id`/`chain_id` (используется политиками
владения, например `SRS-DOM-091` `actor.pharmacyId === order.pharmacyId`), `super_admin` —
`tenant_id = NULL` (платформенная роль, вне скоупа одного тенанта, см. §5.3).

### 3.1 OTP-логин по номеру телефона

Единственный способ входа для человеческих ролей вне Telegram TWA (`customer`, `pharmacist`,
`courier`, `pharmacy_admin`, `super_admin`, `support_agent`) — единая пара эндпоинтов. Домен `OtpCode`
(`purpose='login'`) уже определён `10-domain-model.md` SRS-DOM-080/081/082: 6 цифр, `ttlSeconds=300`
(ASSUMPTION), без собственного лимита попыток внутри VO — анти-брутфорс на этом уровне обязан жить в
`presentation`/`infrastructure` (rate-limit), что и специфицируется здесь.

**Шаг 1 — запрос кода**

```
POST /api/v1/auth/otp/request
{ "phone": "+992901234567" }
```

**SRS-API-018** Ответ ВСЕГДА `202 { "data": { "otpRequestId": "<uuid>", "expiresInSeconds": 300 } }`
независимо от того, существует ли `users` с этим телефоном (защита от перебора существующих номеров
— различие «зарегистрирован/нет» не раскрывается на этом шаге; при первом успешном `verify`
неизвестного телефона аккаунт создаётся автоматически с ролью `customer` — самостоятельная
регистрация доступна ТОЛЬКО для `customer`; `pharmacist`/`courier`/`pharmacy_admin`/`support_agent`/
`super_admin` заводятся заранее административным use case, `Prescription`-подобная авто-регистрация
для них не срабатывает — `verify()` для незарегистрированного номера с ролью, отличной от `customer`,
невозможна структурно, т.к. `users`-строка для персонала создаётся ДО первого входа).

**SRS-API-019** [ASSUMPTION, антибрутфорс] Лимиты запроса кода, ключ — `phone`:
- не чаще `OTP_REQUEST_COOLDOWN_SECONDS = 60` между двумя запросами на один номер;
- не более `OTP_REQUEST_MAX_PER_10MIN = 3` запросов на номер за 10 минут;
- не более `OTP_REQUEST_MAX_PER_DAY = 10` запросов на номер за 24 часа.

Вторичный потолок по IP (защита от массовой рассылки на чужие номера): не более
`OTP_REQUEST_MAX_PER_IP_PER_HOUR = 20`. Превышение любого порога → `429 OTP_REQUEST_RATE_LIMITED` с
`Retry-After`. Код отправляется через `SmsProvider` (Provider Pattern, `MockSmsProvider` пишет код в
лог+БД для dev/тестов, Charter §3.3).

**SRS-API-020** Given `phone` не проходит `PhoneNumber.parse()` (SRS-DOM-069, `^\+992\d{9}$`), When
`POST /auth/otp/request`, Then `400 INVALID_PHONE_FORMAT` (домен-код, переиспользуется здесь) — ДО
применения rate-limit (нет смысла тратить лимит на заведомо невалидный номер).

**Шаг 2 — верификация**

```
POST /api/v1/auth/otp/verify
{ "otpRequestId": "<uuid>", "code": "483920" }
```

**SRS-API-021** Код хранится НЕ в открытом виде — `sha256(code)` в `otp_codes.code_hash` (Charter §5
принцип «секреты не в открытом виде» распространён на OTP; `argon2` избыточен для короткоживущего
6-значного кода с TTL 300с — `sha256` с солью `otpRequestId` достаточен и быстрее при высокой
частоте верификации). Генерация — `OtpGeneratorPort` (крипто-ГПСЧ инфраструктуры, SRS-DOM-081).

**SRS-API-022** [ASSUMPTION, антибрутфорс на уровне эндпоинта — компенсирует отсутствие
`maxAttempts` в самом `OtpCode` для `purpose='login'`, SRS-DOM-080] Счётчик неверных попыток
верификации — по `otpRequestId` (не по `phone` — иначе конкурентный запрос второго кода на тот же
номер не должен наследовать блокировку первого): `OTP_VERIFY_MAX_ATTEMPTS = 5` попыток на один
`otpRequestId`. 6-я попытка (независимо от кода) → `423 OTP_LOCKED`, `otpRequestId` окончательно
недействителен, требуется новый `POST /auth/otp/request` (новый cooldown применяется).

**SRS-API-023** Given код верен и не истёк (`now <= issuedAt + 300s`, включительно — SRS-DOM-172),
When `verify`, Then: (1) find-or-create `User` по `(tenant_id, phone)` (создание — только если роль
неявно `customer`, SRS-API-018); (2) создаётся `AuthSession` (device fingerprint из `User-Agent`,
`ipAddress`, `createdAt`); (3) выпускается пара токенов (§3.2); (4) `otpRequestId` помечается
`consumed=true` — повторный `verify` с тем же `otpRequestId` (даже с верным кодом) → `400
OTP_MISMATCH` (SRS-DOM-082 «`alreadyConsumed`»).

### 3.2 Структура и выдача JWT

**SRS-API-024** [Charter §5] Access token — JWT, алгоритм `RS256` (асимметричный — публичный ключ
может раздаваться другим сервисам для локальной проверки без похода в `identity`), `exp = 15 минут`
от выдачи. Claims: `sub` (`userId`), `role` (`user_role`), `tenantId` (nullable для `super_admin`),
`pharmacyId`/`chainId` (nullable, для персонала), `sessionId` (`auth_sessions.id`), `iat`, `exp`,
`jti` (уникален на токен, для отзыва конкретного access-токена до истечения — редкий путь,
например принудительный logout администратором, §3.4).

**SRS-API-025** Refresh token — НЕ JWT, непрозрачная криптостойкая случайная строка (256 бит,
`crypto.randomBytes`), клиенту отдаётся как есть, на сервере хранится ТОЛЬКО `sha256(token)` в
`auth_sessions.refresh_token_hash` (компрометация БД не даёт готовых токенов). `absoluteExpiresAt =
issuedAt + 30 дней` (Charter §5) — фиксирован в момент ПЕРВОЙ выдачи сессии и НЕ продлевается при
ротации (SRS-API-026); сессия старше 30 дней с момента первого логина обязана быть переaутентифицирована
целиком, даже при активной ежедневной ротации — простой, консервативный потолок «максимальная
непрерывная сессия».

### 3.3 Ротация refresh и обнаружение переиспользования

**SRS-API-026** `POST /api/v1/auth/refresh { "refreshToken": "<opaque>" }`: сервер находит
`auth_sessions` по `sha256(refreshToken)`. Given токен найден, не отозван, не истёк
(`absoluteExpiresAt`), When обработка, Then: (1) текущий refresh помечается `rotated_at=now()`;
(2) выпускается НОВЫЙ access + НОВЫЙ refresh (тот же `family_id`, тот же `absoluteExpiresAt` —
SRS-API-025); (3) старый refresh больше не годен ни для чего, кроме проверки реюза (ниже).

**SRS-API-027** Given предъявлен refresh token, чей `sha256`-хеш совпадает с записью, УЖЕ имеющей
`rotated_at IS NOT NULL` (т.е. токен из прошлого звена цепочки ротации, а не текущий), When
`/auth/refresh`, Then срабатывает **обнаружение переиспользования**: ВСЕ `auth_sessions` с тем же
`family_id` немедленно помечаются `revoked_at=now(), revoke_reason='reuse_detected'` (вся цепочка
устройства, а не только текущее звено — украденный токен мог уже породить параллельную ветвь),
ответ — `401 REFRESH_TOKEN_REUSE_DETECTED`, структурное security-событие пишется в лог (не
пользовательский `audit_log`, а `pino`-уровня `warn` с `userId`, `sessionFamilyId`, `ipAddress`) для
последующего алертинга. Пользователь обязан пройти OTP-логин заново на всех устройствах.

**SRS-API-028** Given refresh token просрочен по `absoluteExpiresAt`, но ещё не был использован
повторно, When `/auth/refresh`, Then `401 REFRESH_TOKEN_INVALID` (не `REUSE_DETECTED` — это штатное
истечение, не атака; клиент должен инициировать полный логин).

### 3.4 Logout и устройства

**SRS-API-029** `POST /api/v1/auth/logout { "refreshToken": "<opaque>" }` — отзывает ТОЛЬКО текущую
`auth_sessions`-запись (`revoked_at=now(), revoke_reason='user_logout'`), не всю `family_id`-цепочку
(в отличие от reuse-detection). `POST /api/v1/auth/logout-all` (требует валидного access-токена,
без тела) — отзывает ВСЕ сессии текущего `userId` независимо от `family_id` (полный выход со всех
устройств, например «я потерял телефон»).

**SRS-API-030** `GET /api/v1/auth/sessions` — список активных устройств текущего пользователя:
`{ id, deviceLabel, ipAddress (маскирован — SRS-API-149), lastSeenAt, createdAt, isCurrent }`.
`DELETE /api/v1/auth/sessions/:id` — отзыв конкретного устройства (не обязательно текущего —
«разлогинить старый телефон» сценарий). Владение проверяется: `session.userId === actor.userId`,
иначе `403 FORBIDDEN` (даже для `super_admin` — принудительный отзыв ЧУЖОЙ сессии — отдельный
административный эндпоинт `POST /api/v1/admin/users/:id/force-logout`, не переиспользует этот путь,
чтобы не создавать неявную суперспособность в обычном self-service API).

### 3.5 Авторизация Telegram Mini App (TWA)

[REQ-TG-1, REQ-TG-2] Отдельный `AuthProvider` (`TelegramAuthProvider` — infrastructure), тот же
формат JWT на выходе (SRS-API-024).

```
POST /api/v1/auth/telegram
{ "initData": "query_id=...&user=%7B%22id%22...&auth_date=1756289000&hash=abc123..." }
```

**SRS-API-031** Алгоритм проверки подписи (пошагово, точная реализация Telegram WebApp
`validate`-схемы):

1. Распарсить `initData` как `application/x-www-form-urlencoded` в пары ключ=значение.
2. Извлечь и удалить поле `hash` из набора — оно не участвует в вычислении контрольной строки.
3. Отсортировать ОСТАВШИЕСЯ пары по ключу лексикографически, собрать `data_check_string` в формате
   `"{key1}={value1}\n{key2}={value2}\n..."` (значения — как есть, без повторного urldecode-кодирования
   внутри строки).
4. Вычислить `secret_key = HMAC_SHA256(key = "WebAppData", data = TELEGRAM_BOT_TOKEN)` (байтовый
   результат, не hex).
5. Вычислить `computed_hash = HEX(HMAC_SHA256(key = secret_key, data = data_check_string))`.
6. Сравнить `computed_hash` с полем `hash` из initData **constant-time** (`crypto.timingSafeEqual`).
   Несовпадение → `401 INVALID_TELEGRAM_INIT_DATA`.
7. Проверить `auth_date`: `now() - auth_date <= TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` (ENV, дефолт
   `300`, REQ-TG-1). Просрочено → `401 TELEGRAM_AUTH_DATE_EXPIRED`.
8. Распарсить JSON-поле `user` (`{ id, first_name, last_name?, username?, language_code? }`).
9. Найти/создать `User` по `(tenant_id, telegram_user_id)` через таблицу-связку
   `user_telegram_identities(user_id, telegram_user_id, tenant_id)` — телефон НЕ обязателен на этом
   шаге (Telegram не гарантирует его); поле `phone` запрашивается отдельно при оформлении заказа как
   контакт для доставки (не блокирует браузинг каталога).
10. Выпустить JWT/refresh как в SRS-API-024/025, `AuthSession.deviceLabel = 'telegram_twa'`.

**SRS-API-032** `TELEGRAM_BOT_TOKEN` — per-tenant (у White-Label сети свой `@SifatPharmaBot`, tz.log
§III), резолвится ПОСЛЕ определения тенанта (§5) из `tenant_settings.telegram_bot_token_ref`
(ссылка на секрет, не сам токен в открытом виде в этой таблице). Given тенант не имеет
настроенного бота, When запрос на `/auth/telegram` для этого тенанта, Then `404
UNKNOWN_TENANT_SLUG`-подобная ошибка не подходит семантически — используется `503
SERVICE_UNAVAILABLE` с `details.reason='telegram_bot_not_configured'` (временное состояние
конфигурации, не постоянный запрет).

### 3.6 1С: `X-Pharmacy-API-Key` + HMAC-SHA256 (D-11)

Единственный небраузерный, не-пользовательский принципал: `pharmacy_system`. НЕ выпускает JWT — каждый
запрос самодостаточен (stateless HMAC), что соответствует профилю интеграции 1С (батчевые вызовы без
сессии). Основной эндпоинт: `POST /api/v1/inventory/batch-update` (tz.log Модуль 4, D-11, REQ-SYNC-14).

**Формат ключа**: при выдаче/ротации (`pharmacyAccount.rotateApiKey()`, SRS-DOM-051) генерируется
строка `sec_live_{keyId:12 hex}.{secret:32 hex}` (пример из tz.log: `sec_live_9f83a2c8e17b...`
трактуется как эта форма). `keyId` — хранится в `pharmacy_api_keys.key_prefix` ОТКРЫТО и
проиндексирован (нужен для быстрого поиска строки без перебора); `secret` — хранится ТОЛЬКО как
`argon2_hash(secret)` в `pharmacy_api_keys.secret_hash` (SRS-DOM-051). Полная строка ключа никогда не
хранится и не логируется (§9.4).

**SRS-API-033** Заголовки запроса:

```
X-Pharmacy-API-Key: sec_live_9f83a2c8e17b.a1b2c3d4e5f6...
X-Pharmacy-Timestamp: 1756289000
X-Pharmacy-Nonce: 7f3e9c2a-1b4d-4e8a-9c3f-6d2e8a1b4c9f
X-Pharmacy-Signature: 9c8b7a6f5e4d3c2b1a0f...
```

**Алгоритм проверки** (`PharmacyApiKeyGuard`, presentation, делегирует в `application`-порт
`PharmacyApiKeyVerificationPort`):

1. Распарсить `X-Pharmacy-API-Key` на `keyId.secret` по первому `.`. Отсутствие точки/пустая часть →
   `401 PHARMACY_API_KEY_INVALID`.
2. `SELECT * FROM pharmacy_api_keys WHERE key_prefix = :keyId AND revoked_at IS NULL`. Не найдено →
   `401 PHARMACY_API_KEY_INVALID` (не раскрывать, существует ли `keyId` — единая ошибка).
3. `argon2.verify(secret_hash, secret)`. Несовпадение → `401 PHARMACY_API_KEY_INVALID`.
4. Given `pharmacy_api_keys.require_mtls = true`, When TLS-терминация (Nginx) не передала верифицированный
   клиентский сертификат (заголовок `X-SSL-Client-Verify: SUCCESS`, устанавливаемый ТОЛЬКО Nginx,
   недоступный для прямой подделки клиентом — Nginx перезаписывает любой одноимённый входящий
   заголовок), Then `401 MTLS_REQUIRED`.
5. Проверить `|now() - X-Pharmacy-Timestamp| <= PHARMACY_SIGNATURE_WINDOW_SECONDS` (ENV, дефолт `300`,
   D-11 «окно 5 минут»). Вне окна → `401 PHARMACY_TIMESTAMP_OUT_OF_WINDOW`.
6. Redis `SET pharmacy_nonce:{pharmacyId}:{nonce} 1 NX EX 300`. Given ключ уже существовал (`NX`
   вернул отказ), Then `401 PHARMACY_REQUEST_REPLAYED` (анти-replay, D-11).
7. Собрать канонический буфер:
   `canonical = "{METHOD}\n{path}\n{X-Pharmacy-Timestamp}\n{X-Pharmacy-Nonce}\n{hex(sha256(rawBody))}"`
   (`METHOD` — верхний регистр, `path` — без query-строки, `rawBody` — исходные байты тела ДО
   парсинга JSON — подпись должна покрывать байты, которые реально пришли по проводу).
8. `expected = hex(HMAC_SHA256(key = secret, data = canonical))` (тот же `secret`, полученный из
   заголовка на шаге 1 — сервер имеет его в памяти этого запроса, не восстанавливает из хеша — хеш
   служит только для аутентификации личности ключа на шаге 3, а не для вычисления HMAC).
9. `crypto.timingSafeEqual(expected, X-Pharmacy-Signature)`. Несовпадение → `401
   PHARMACY_SIGNATURE_INVALID`.
10. Успех → принципал `{ type: 'pharmacy_system', pharmacyId, chainId }` прокидывается в
    `application`-слой use case `IngestInventoryBatchUseCase` как контекст авторизации (не JWT, но та
    же форма «текущий актор» для унификации логирования/аудита).

**SRS-API-034** Модель ключей 1С — МНОЖЕСТВЕННЫЕ ключи на аптеку (не один активный ключ,
ротируемый целиком): `PharmacyAccount` может иметь несколько записей `pharmacy_api_keys`
одновременно (например, на период миграции 1С-конфигурации, или отдельный ключ на филиал сети).
Полный набор административных эндпоинтов (роль `pharmacy_admin` своей точки/`super_admin` любой,
детали — модуль `27-module-admin-moderation-onboarding.md` §5.4, `SRS-ADM-043..046`, эта версия —
НОРМАТИВНАЯ, приоритет над любым другим упоминанием формы эндпоинта в этом документе):

| Эндпоинт | Назначение |
|---|---|
| `POST /api/v1/pharmacy-accounts/:id/api-keys` | Создание нового ключа (`SRS-ADM-043`) |
| `GET /api/v1/pharmacy-accounts/:id/api-keys` | Список ключей аптеки (без секретов, `SRS-ADM-044`) |
| `POST /api/v1/pharmacy-accounts/:id/api-keys/:keyId/rotate` | Ротация КОНКРЕТНОГО ключа `:keyId` (`SRS-ADM-045`) |
| `POST /api/v1/pharmacy-accounts/:id/api-keys/:keyId/revoke` | Немедленный отзыв КОНКРЕТНОГО ключа `:keyId` (`SRS-ADM-046`) |
| `PATCH /api/v1/pharmacy-accounts/:id/api-keys/:keyId` | Изменение флагов ключа (`requireMtls`, `SRS-ADM-046`) |

Ротация (`PharmacyAccount.rotateApiKey(keyId)`, эндпоинт `POST
/api/v1/pharmacy-accounts/:id/api-keys/:keyId/rotate`, `Idempotency-Key` обязателен — SRS-API-009):
старый ключ `:keyId` помечается `revoked_at = now() + API_KEY_ROTATION_GRACE_HOURS` (ASSUMPTION 24
часа) — не мгновенно, чтобы 1С-конфигурация на стороне аптеки успела перейти на новый ключ без
простоя синхронизации; новый ключ (отдельная запись, `rotated_from = :keyId`) действителен
немедленно. По истечении grace-периода фоновая job необратимо инвалидирует старый (`revoked_at`
фиксируется в прошлом, ключ больше не проходит шаг 2 проверки §3.6). Ротация одного ключа НЕ
затрагивает остальные активные ключи той же аптеки.

### 3.7 Мобильные клиенты (Flutter): фармацевт и курьер

**SRS-API-035** [Charter §3.6, §3.6 устава] `apps/pharmacy_mobile`/`apps/courier_mobile` — те же
`POST /api/v1/auth/otp/request`/`verify` (§3.1), тот же формат JWT/refresh (§3.2/3.3). Разница —
только в `infrastructure` клиента: `dio`-интерцептор добавляет `Authorization: Bearer <access>` к
каждому запросу, перехватывает `401 TOKEN_EXPIRED` → вызывает `/auth/refresh` ровно один раз →
повторяет исходный запрос с новым токеном; повторный `401` после рефреша → переход на экран логина
(не бесконечный цикл рефреша). Модели генерируются из `docs/api/openapi.json` (§8) — Flutter НЕ
хардкодит формат токена/эндпоинтов вручную (Charter §3.6 п.2). Персонал (`pharmacist`/`courier`)
предварительно заводится `pharmacy_admin`/`super_admin` через `POST /api/v1/staff-accounts` (роль
`pharmacy_admin` может создавать только `pharmacist` своей аптеки/сети; `courier` для собственного
флота (`chainId` заполнен) — тоже `pharmacy_admin`; курьер платформенного пула (`chainId = NULL`) —
только `super_admin`, RBAC-матрица §4).

---

## 4. RBAC

**SRS-API-036** [`02` §3.4] Guard (`RolesGuard`, presentation) проверяет ТОЛЬКО: (1) валиден ли JWT
(аутентификация); (2) входит ли `token.role` в список, объявленный декоратором `@Roles('pharmacy_admin',
'super_admin')` на контроллере/методе (грубая проверка роли). Условная авторизация («это ЕГО заказ»,
«эта аптека принадлежит ЕГО сети», «сумма ниже порога, доступного `support_agent`») — ВСЕГДА в
`application/policies/*.policy.ts`, вызываемых из use case, НЕ в guard'е (иначе политика становится
непроверяемой без HTTP, `02` §3.4). Guard, пропустивший запрос дальше своей роли, но не проверивший
владение, — не дефект: это ожидаемое разделение ответственности.

**SRS-API-037** Роли (`user_role` ENUM, tz.log §II.2 + расширение REQ-DISPUTE-18): `customer`,
`pharmacist`, `courier`, `pharmacy_admin`, `super_admin`, `support_agent`. Системные принципалы
(`pharmacy_system` §3.6, `bank_webhook` — HMAC-проверка вебхука провайдера, REQ-PAY-2, не JWT и не
человек) — вне этой матрицы, у них ЖЁСТКО ФИКСИРОВАННЫЙ, нерасширяемый набор из одного эндпоинта
каждый (`/inventory/batch-update`, `/payments/webhook`), не участвуют в permission-string модели ниже.

**SRS-API-038** Формат permission string: `<resource>:<action>[:<scope>]`, `scope ∈ {own, pharmacy,
chain, any}` там, где применимо (например `orders:read:own` — клиент видит свои заказы,
`orders:read:pharmacy` — фармацевт видит заказы своей аптеки, `orders:read:any` — `super_admin`).
Permission-строки — константы `packages/contracts/src/permissions.ts`, использует их и `@Roles(...)`
декоратор (грубая роль), и `application`-политики (уточнение по `scope`).

### 4.1 Матрица прав

> «✅» — разрешено безусловно в рамках роли; «❌» — запрещено; «⚠ <условие>» — разрешено ТОЛЬКО при
> условии, проверяемом `application`-политикой (не guard'ом). Диспетчерские действия (переназначение
> курьера, ручной override возврата) закреплены за `pharmacy_admin` (в скоупе своей сети,
> собственный флот) и `super_admin` (платформенный пул/эскалация) — отдельной роли «диспетчер» в
> `user_role` не заводится (research не вводит такую роль; функция — это разрешение, а не роль).

| Permission | customer | pharmacist | courier | pharmacy_admin | support_agent | super_admin |
|---|---|---|---|---|---|---|
| `catalog:search`, `catalog:read` | ✅ (публично, JWT не обязателен) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `orders:create` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `orders:read:own` | ✅ | — | — | — | — | — |
| `orders:read:pharmacy` | ❌ | ⚠ `order.pharmacyId === actor.pharmacyId` | ❌ | ⚠ то же (админ своей сети) | ⚠ по назначенному тикету (`support_tickets.orderId`) | — |
| `orders:read:any` | ❌ | ❌ | ❌ | ❌ | ⚠ только при открытом тикете | ✅ |
| `orders:cancel` | ⚠ `OrderPolicy.canCancel` (SRS-DOM-154), только `pending_payment/paid_escrow/processing` | ⚠ то же, своя аптека | ❌ | ⚠ то же, своя сеть | ❌ | ✅ (`AdminForceCancelOrderUseCase`, SRS-DOM-171) |
| `orders:start-processing` (сборка) | ❌ | ⚠ своя аптека, `paid_escrow` | ❌ | ❌ | ❌ | ❌ |
| `orders:mark-picked-up` | ❌ | ⚠ своя аптека | ❌ | ❌ | ❌ | ❌ |
| `orders:mark-delivered` (OTP вручения) | ❌ | ❌ | ⚠ назначен на `DeliveryAssignment` этого заказа | ❌ | ❌ | ❌ |
| `prescriptions:upload` | ✅ (свой рецепт) | ❌ | ❌ | ❌ | ❌ | ❌ |
| `prescriptions:verify` | ❌ | ⚠ своя аптека, заказ назначен (SRS-DOM-155) | ❌ | ❌ | ❌ | ❌ |
| `prescriptions:read-image` | ⚠ владелец (SRS-DOM-155а) | ⚠ назначен на заказ (SRS-DOM-155б) | ❌ | ❌ (только метаданные статуса, SRS-DOM-155) | ❌ | ⚠ с обязательной записью `audit_log` (SRS-DOM-155в) |
| `inventory:ingest` | — (см. `pharmacy_system`, §3.6) | ❌ | ❌ | ✅ (ручной ввод/Excel, D-12) | ❌ | ✅ |
| `inventory:read` | ❌ (только агрегировано через `catalog:search`) | ✅ своя аптека | ❌ | ✅ своя сеть | ❌ | ✅ |
| `disputes:open` | ✅ (по своему заказу) | ❌ | ❌ | ❌ | ✅ | ✅ |
| `disputes:resolve-reject` | ❌ | ❌ | ❌ | ❌ | ✅ (кроме своей сети — SRS-DOM-061) | ✅ |
| `disputes:resolve-refund-full` | ❌ | ❌ | ❌ | ❌ | ⚠ только `amount < dispute_auto_refund_threshold_dirams` (SRS-DOM-133, ASSUMPTION 15000) | ✅ |
| `disputes:resolve-refund-partial` | ❌ | ❌ | ❌ | ❌ | ❌ (REQ-DISPUTE-9, жёсткий запрет независимо от суммы) | ✅ |
| `disputes:resolve-adjustment` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ только |
| `returns:request` | ✅ свой заказ | ❌ | ⚠ по назначению | ❌ | ❌ | ✅ |
| `returns:confirm` (чек-лист приёмки) | ❌ | ⚠ своя аптека | ❌ | ❌ | ❌ | ❌ |
| `returns:admin-override` | ❌ | ❌ | ❌ | ✅ своя сеть | ❌ | ✅ |
| `delivery:reassign` | ❌ | ❌ | ❌ | ✅ свой флот (собственные курьеры сети) | ❌ | ✅ (включая платформенный пул) |
| `delivery:record-cash` | ❌ | ❌ | ⚠ назначенный курьер, свой рейс | ❌ | ❌ | ❌ |
| `pharmacy-accounts:approve` (онбординг) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `pharmacy-accounts:suspend` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `pharmacy-accounts:update-address` | ❌ | ❌ | ❌ | ✅ своя аптека (→ `pending_review`, SRS-DOM-049) | ❌ | ✅ |
| `staff-accounts:create` | ❌ | ❌ | ❌ | ✅ (`pharmacist`/`courier` своей сети) | ❌ | ✅ (любая роль) |
| `tenancy:manage-branding` | ❌ | ❌ | ❌ | ⚠ только для тенанта своей сети, если `is_whitelabel_active` | ❌ | ✅ |
| `tenancy:manage-commission-rates` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `moderation:resolve-catalog-match` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `audit-log:read` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `1c-sync:history:read` | ❌ | ❌ | ❌ | ✅ своя сеть (REQ-SYNC-10) | ❌ | ✅ |

**SRS-API-039** Given `pharmacy_admin` вызывает `disputes:resolve-*`, When guard проверяет
`@Roles(...)`, Then `pharmacy_admin` в списке ролей эндпоинта НЕ значится вовсе (не «условно
запрещено» — маршрут физически недоступен этой роли, `403 INSUFFICIENT_ROLE` на уровне guard'а, не
доходя до application policy) — только `support_agent`/`super_admin` допущены к диспут-резолюции
как принципалы (владелец аптеки не резолвит споры по своим же заказам — конфликт интересов,
REQ-DISPUTE-10).

**SRS-API-040** [SRS-DOM-062] `tenant_admin`-подобное действие `confirmTenantRefund` — НЕ отдельная
роль: это `pharmacy_admin`, чей `chain_id` совпадает с `chain_id` тенанта заказа, вызывающий
специфичный эндпоинт `POST /api/v1/disputes/:id/confirm-tenant-refund`. Проверка — `application`
policy `DisputeAuthorizationPolicy.canConfirmTenantRefund(actor, dispute)`, не новая роль в
`user_role`.

---

## 5. Мультитенантность

**SRS-API-041** [Charter §3.4] Резолвинг тенанта — `TenantResolutionMiddleware`, выполняется ДО
`AuthGuard`/`RolesGuard` (тенант нужен для поиска `users` по `(tenant_id, phone)`, §3.1, значит
должен быть известен раньше аутентификации). Алгоритм, строго по приоритету:

1. **Host.** `Host`-заголовок (без порта) ищется в кэше `tenant:by-domain:{host}` (Redis, TTL 60с,
   инвалидируется событием `TenantBrandingUpdatedEvent`/доменной привязкой) → если промах, `SELECT *
   FROM tenants WHERE custom_domain = :host`. Найдено → тенант резолвлен, `X-Tenant-Slug` (если
   передан) **игнорируется** (Host — источник истины при явном совпадении домена; расхождение
   логируется `pino.warn` как потенциальная неверная конфигурация клиента, не блокирует запрос).
2. **X-Tenant-Slug.** Given Host не резолвлен (не совпал ни с одним `custom_domain` — типичный
   случай для мобильных клиентов/Telegram-бота, у которых нет собственного домена per-tenant), When
   заголовок `X-Tenant-Slug` присутствует, Then `SELECT * FROM tenants WHERE slug = :slug`. Given
   `slug` не найден в таблице, Then `404 UNKNOWN_TENANT_SLUG` — НЕ провал молча в `neutral`
   (заведомо опечатанный/несуществующий slug — ошибка клиента, не повод тихо подставить другой
   тенант).
3. **Neutral.** Given ни Host, ни `X-Tenant-Slug` не дали результата (публичный домен
   `dorutj.com`/`www.dorutj.com`/прямой IP/локальная разработка), Then тенант = строка `slug =
   'neutral'` (единственная, D-01/SRS-DOM-042).

**SRS-API-042** Given ни один шаг не завершился успешно ПО ТЕХНИЧЕСКОЙ причине (например, БД/кэш
недоступны для поиска по `custom_domain`, а `neutral` тоже не удалось прочитать), When любой
защищённый (не публичный, §7) эндпоинт, Then `TenantResolutionGuard` (отдельный от middleware —
последняя защита перед контроллером) отклоняет запрос `400 TENANT_NOT_RESOLVED` — ни один
запрос к репозиторию НЕ выполняется без резолвленного `tenantId` в контексте (Charter §3.4 «guard,
запрещающий запрос без резолва тенанта»).

**SRS-API-043** Резолвленный контекст (`{ tenantId, slug, chainId?, isNeutral }`) кладётся в
request-scoped `AsyncLocalStorage` (`TenantContext`, presentation/infrastructure мост) ДО вызова
любого контроллера. Каждый Drizzle-репозиторий (`infrastructure`) обязан принимать `tenantId` как
ПЕРВЫЙ явный параметр конструктора/метода (не читать его сам из `AsyncLocalStorage` неявно внутри
метода — явная передача делает утечку видимой при код-ревью и тестируемой без HTTP-контекста, `02`
§3.2). `dependency-cruiser`/ESLint-правило (`02` §6) статически не может проверить «есть ли
`WHERE tenant_id=`» в SQL — эта гарантия обеспечивается ОБЯЗАТЕЛЬНЫМ unit-тестом на каждый репозиторий
(«вызов без `tenantId` — ошибка типов на этапе компиляции», т.к. параметр не опционален) и
интеграционным тестом на утечку между тенантами (Charter §3.4, TC-API-030 ниже).

**SRS-API-044** `super_admin`: `token.tenantId = NULL` (SRS-API-017). Given `super_admin` обращается
к тенант-скоупному ресурсу (например, `GET /api/v1/pharmacy-accounts?tenantId=<X>`), When guard
проверяет доступ, Then `null`-tenant токен НЕ освобождает от резолвинга тенанта запроса (§5.1 всё
равно отрабатывает по `Host`/`X-Tenant-Slug` как обычно) — освобождается только проверка «совпадает
ли `token.tenantId` с резолвленным `tenantId` запроса» (обычным ролям эта проверка обязательна,
SRS-API-045); `super_admin` может явно указать ЛЮБОЙ `tenantId` через `X-Tenant-Slug`, включая чужой,
и получить доступ — операция всегда логируется в `audit_log` с пометкой `crossTenantOverride=true`.

**SRS-API-045** Given аутентифицирован НЕ `super_admin` (любая другая роль), When
`token.tenantId !== resolvedTenantId` текущего запроса (пользователь тенанта A обращается через
домен/slug тенанта B — например, украл/скопировал access-токен и подставил на чужом поддомене),
Then `403 CROSS_TENANT_ACCESS_DENIED` немедленно на уровне `TenantResolutionGuard`, ДО входа в
контроллер — не полагается на то, что репозиторий сам отфильтрует данные (defense in depth: даже
если бы фильтрация репозитория содержала баг, guard уже остановил запрос).

**SRS-API-046** [Charter §3.4, обязательный тест] Given тенант A и тенант B оба содержат заказы,
When любой запрос от имени пользователя тенанта A (валидный JWT, `tenantId=A`) выполняется против
ресурса тенанта B по `id` (например, `GET /api/v1/orders/:idФ, где `:id` принадлежит заказу тенанта
B), Then ответ — `404 NOT_FOUND` (не `403`) — репозиторий тенанта A физически не может найти строку
из-за обязательного `WHERE tenant_id = :tenantId` в каждом SELECT (SRS-API-043); различие «нет
доступа» vs «не существует» намеренно не раскрывается для ресурсов внутри чужого тенанта (не
подтверждаем даже факт существования ID у постороннего тенанта).

---

## 6. Реалтайм-канал

**SRS-API-047** [Charter §3.6 п.4] Единый эндпоинт `wss://<host>/api/v1/realtime` для веб и Flutter
(`web_socket_channel` на стороне Dart, нативный `WebSocket`/переподключаемая обёртка на web).
Никаких web-only SSE/long-polling фоллбэков в контракте — деградация подписки (§6.5) одинакова для
всех клиентов.

### 6.1 Handshake и аутентификация

**SRS-API-048** Тенант резолвится ДО апгрейда соединения (тот же алгоритм §5, по `Host`
рукопожатия/`X-Tenant-Slug` первого HTTP-запроса на апгрейд — WS не имеет собственных кастомных
заголовков после апгрейда на многих клиентах, поэтому тенант фиксируется на этапе HTTP-handshake).
После открытия соединения клиент ОБЯЗАН в течение `WS_AUTH_TIMEOUT_MS` (ASSUMPTION 5000) отправить
первым кадром:

```json
{ "type": "auth", "token": "<access JWT>" }
```

**SRS-API-049** Given кадр `auth` не получен за `WS_AUTH_TIMEOUT_MS`, ИЛИ токен невалиден/просрочен,
ИЛИ `token.tenantId` не совпадает с тенантом, резолвленным при handshake (кроме `super_admin`,
SRS-API-044), When любой из случаев, Then сервер закрывает соединение с WS-кодом `4401` (кастомный
диапазон приложения, `4000-4999` зарезервирован RFC 6455 для приложений) и не отправляет ни одного
данных-кадра до этого момента. Успешная аутентификация → сервер отправляет
`{ "type": "auth_ok", "sessionId": "..." }` и присоединяет сокет к комнатам по роли (§6.2).

**SRS-API-050** Given `access` токен истекает (`exp`) ПОКА соединение открыто (сессия браузера
дольше 15 минут), When наступает `exp`, Then сервер проактивно закрывает соединение кодом `4401` (не
ждёт следующего исходящего события) — клиент обязан прозрачно обновить токен через
`POST /auth/refresh` (REST, §3.3) и переподключиться с новым access-токеном; сервер не принимает
`{"type":"reauth", token}` в живом соединении — переподключение проще, чем стейтфул смена токена в
рамках одного сокета, и не даёт разночтений с REST-логикой ротации.

### 6.2 Комнаты подписки по ролям

| Роль | Комнаты | Назначение |
|---|---|---|
| `customer` | `customer:{userId}` | Обновления собственных заказов/рецептов/споров |
| `pharmacist` | `pharmacy:{pharmacyId}` | Новые заказы (звук, CUJ-3), статусы синхронизации |
| `pharmacy_admin` | `pharmacy:{pharmacyId}` (все точки сети) + `chain:{chainId}` | Агрегированные события сети, история 1С-синхронизаций |
| `courier` | `courier:{courierId}` | Персональные назначения/переназначения |
| `support_agent` | `platform:ops` | Споры, SLA-нарушения |
| `super_admin` | `platform:ops` + любая `pharmacy:{id}`/`chain:{id}`/`courier:{id}` по явной подписке | Наблюдение за любой сущностью платформы |

**SRS-API-051** `super_admin` может дополнительно подписаться на произвольную комнату кадром
`{ "type": "subscribe", "room": "pharmacy:<id>" }` (например, для живого дашборда конкретной аптеки).
Given любая другая роль отправляет `subscribe` на комнату вне своего автоматического набора, When
сервер получает кадр, Then ответ `{ "type": "error", "code": "WS_ROOM_FORBIDDEN" }`, соединение НЕ
закрывается (в отличие от auth-ошибок — это некритичная попытка, не обязательно означающая
компрометацию токена).

### 6.3 Полный список событий

> Payload — по таблице «Доменные события» `10-domain-model.md`, здесь — только маппинг на
> WS-имя/комнату (dot.case, `resource.verb_past`). События без строки «Комната» помечены
> «internal» — они существуют в `outbox` для межмодульной интеграции, но НЕ пересылаются в WS (нет
> потребителя на клиенте, снижает шум канала).

| WS-событие | Домен-событие (`10-domain-model.md`) | Комната(ы) |
|---|---|---|
| `order.paid` | `OrderPaidEvent` | `customer:{customerId}`, `pharmacy:{pharmacyId}` |
| `order.processing_started` | `OrderProcessingStartedEvent` | `customer:{customerId}` |
| `order.picked_up` | `OrderPickedUpEvent` | `customer:{customerId}`, `courier:{courierId}` (после назначения) |
| `order.delivered` | `OrderDeliveredEvent` | `customer:{customerId}`, `pharmacy:{pharmacyId}` |
| `order.cancelled` | `OrderCancelledEvent`/`OrderAutoCancelledEvent` | `customer:{customerId}`, `pharmacy:{pharmacyId}` |
| `order.refunded` | `OrderRefundedEvent` | `customer:{customerId}` |
| `payout.due` / `payout.paid` / `payout.held` / `payout.released` | `PayoutDueEvent`/... | `chain:{chainId}` (только `pharmacy_admin`) |
| `prescription.ocr_started` | `PrescriptionOcrRequestedEvent` | `customer:{customerId}` |
| `prescription.auto_matched` | `PrescriptionAutoMatchedEvent` | `customer:{customerId}` |
| `prescription.needs_clarification` | `PrescriptionNeedsClarificationEvent` | `customer:{customerId}` |
| `prescription.rejected` | `PrescriptionRejectedEvent` | `customer:{customerId}` |
| `prescription.verified` | `PrescriptionVerifiedEvent` | `customer:{customerId}` |
| `inventory.sync_completed` / `inventory.sync_failed` | `InventorySyncBatchCompletedEvent`/`Failed` | `pharmacy:{pharmacyId}` |
| `inventory.match_pending` | `UnmatchedInventoryRowEvent` | `pharmacy:{pharmacyId}` |
| `delivery.courier_assigned` | `CourierAssignedEvent` | `customer:{customerId}`, `courier:{courierId}`, `pharmacy:{pharmacyId}` |
| `return.requested` / `.arrived_at_pharmacy` / `.confirmed` / `.rejected` | `ReturnRequestedEvent`/... | `customer:{customerId}`, `pharmacy:{pharmacyId}` |
| `dispute.opened` / `dispute.resolved` | `DisputeOpenedEvent`/`DisputeResolvedEvent` | `customer:{customerId}`, `platform:ops` |
| `ops.sla_breached` | `SlaBreachedEvent` | `platform:ops` |
| `pharmacy.suspended` / `pharmacy.activated` / `chain.activated` | `PharmacySuspendedEvent`/... | `pharmacy:{pharmacyId}`, `platform:ops` |
| `pharmacy.license_expiring` / `.license_auto_suspended` | `LicenseExpiringSoonEvent`/... | `chain:{chainId}` |
| `tenant.branding_updated` | `TenantBrandingUpdatedEvent` | все клиенты тенанта (широковещательно по резолвленному `tenantId` соединения — не персональная комната, а implicit по подключению) |
| — (internal) | `EscrowFeeCapturedEvent`, `NewControlCategoryCandidateEvent`, `DeliveryCompletedEvent` | не пересылаются в WS |

### 6.4 Heartbeat

**SRS-API-052** Сервер отправляет `{ "type": "ping", "ts": <unix_ms> }` каждые
`WS_HEARTBEAT_INTERVAL_MS` (ASSUMPTION 25000). Клиент обязан ответить `{ "type": "pong" }` в течение
`WS_HEARTBEAT_TIMEOUT_MS` (ASSUMPTION 10000). Given 2 подряд пропущенных `pong`, When таймаут
истекает второй раз, Then сервер закрывает соединение кодом `4408` (`CONNECTION_STALE`, кастомный) —
предполагается «клиент завис/сеть недоступна», ресурсы освобождаются раньше стандартного TCP-таймаута.

### 6.5 Реконнект и пропущенные события

**SRS-API-053** [Charter §3.6 п.4] WS — канал НИЗКОЙ ЛАТЕНТНОСТИ для UX (мгновенное «заказ принят
аптекой»), НЕ гарантированная доставка. Соответственно, сервер НЕ ведёт журнал событий для WS-replay.
Given соединение разорвано (сеть/фон/сон устройства) и клиент переподключился, When он снова
отправляет валидный `auth`, Then сервер НЕ пытается «доотправить» пропущенные события за период
разрыва — клиент ОБЯЗАН немедленно выполнить catch-up через REST: `GET /api/v1/orders/:id` (или
список активных заказов `GET /api/v1/orders?filter[status][in]=...`) для восстановления актуального
состояния, и только затем полагаться на новые WS-события как на дельту поверх уже свежего REST-снимка.
Это стандартный паттерн «WS как hint, REST как источник истины»; клиент, который полагается
исключительно на WS без REST-catch-up после реконнекта, — дефект клиентского кода, не серверного
контракта.

**SRS-API-054** Клиентская стратегия переподключения (документируется здесь как обязательный
контракт клиента, не серверный код): экспоненциальный backoff `1с, 2с, 4с, 8с, 16с, macс 30с`, джиттер
±20%. Курьерское/фармацевтское Flutter-приложение обязано инициировать REST-catch-up СРАЗУ по
восстановлению соединения, ДО повторной подписки на WS (порядок важен — иначе окно гонки между
устаревшим REST-запросом и уже пришедшим WS-событием).

---

## 7. Мета-эндпоинты для тонких клиентов

[Charter §3.6 п.5/6] Публичные (не требуют `Authorization`), тенант-скоупные (§5 всё равно
резолвится — брендинг/лимиты различаются по тенанту), кэшируемые.

**SRS-API-055** `GET /api/v1/meta` — единственный источник enum'ов и конфигурационных порогов для
клиента (Charter «клиент не хардкодит enum'ы»):

```json
{
  "data": {
    "enums": {
      "orderStatus": ["pending_payment", "paid_escrow", "processing", "picked_up", "delivered", "cancelled", "refunded", "return_in_progress"],
      "controlCategory": ["none", "prescription_only", "potent", "psychotropic", "narcotic"],
      "dosageUnit": ["mg", "mcg", "g", "ml", "iu", "percent", "mg_per_ml"],
      "userRole": ["customer", "pharmacist", "courier", "pharmacy_admin", "super_admin", "support_agent"],
      "paymentMethod": ["alif_mobi", "dc_next", "cash_courier"]
    },
    "config": {
      "otpLoginLength": 6,
      "otpLoginTtlSeconds": 300,
      "handoverOtpLength": 4,
      "handoverOtpTtlSeconds": 900,
      "codLimitDiram": 50000,
      "pickupSlaMinutes": 7,
      "inventoryDeltaSlaMinutes": 5
    },
    "metaVersion": "2026-08-27T00:00:00Z-a1b2c3"
  }
}
```

**SRS-API-056** `config.*` — значения РЕЗОЛВЛЕННОГО тенанта (per-tenant переопределения, например
`codLimitDiram`, D-16), НЕ глобальные константы — тот же эндпоинт для тенанта A и тенанта B
возвращает разные числа, если у них разные `tenant_settings`.

**SRS-API-057** Кэширование: `Cache-Control: public, max-age=300`, `ETag = metaVersion` (хэш от
`updated_at` конфигурации тенанта + версии релиза enum-набора). Изменение `tenant_settings`
(например, `codLimitDiram` через админку) немедленно меняет `metaVersion` → следующий запрос с
устаревшим `If-None-Match` получает полное тело `200`, а не `304`.

**SRS-API-058** `GET /api/v1/i18n/:locale` (`locale ∈ {tj, ru, en}`) — полный словарь ключей для
данной локали (Charter §3.6 п.6, единый источник строк для React и Flutter). Ответ:
`{ "data": { "locale": "tj", "dictionary": { "brand.name": "...", "order.status.paid_escrow": "...", ... } } }`.
`Cache-Control: public, max-age=3600`, `ETag` — хэш содержимого словаря. Given `:locale` вне набора
`{tj,ru,en}`, When запрос, Then `404 UNSUPPORTED_LOCALE`.

**SRS-API-059** `GET /api/v1/tenant/branding` — резолвится ИЗ УЖЕ определённого тенанта запроса
(§5, без параметров): `{ "data": { "slug", "brandName", "palette": { "--brand-primary": "#...", ... },
"logoUrl", "faviconUrl", "telegramBotUsername"?, "supportPhone" } }`. `brandName` — ТОЛЬКО из
`tenant.settings.brandName` (D-01, SRS-DOM-046 — нигде не хардкожена строка «DoruTJ»). Кэш —
`ETag = tenant.updatedAt`, инвалидация — событие `TenantBrandingUpdatedEvent` (уже определено в
`10-domain-model.md`) триггерит WS-нотификацию `tenant.branding_updated` (§6.3) для уже открытых
клиентов + сброс HTTP-кэша на следующий запрос.

---

## 8. OpenAPI

**SRS-API-060** [Charter §3.6 п.2, §3.2] Спецификация OpenAPI 3.1 генерируется автоматически из
Zod-схем `packages/contracts` через `@asteasolutions/zod-to-openapi` (мост Zod→OpenAPI, единый
источник правды — не дублирование описания вручную через `@nestjs/swagger`-декораторы поверх тех же
DTO). Каждый Zod-объект в `packages/contracts`, участвующий в теле запроса/ответа, регистрируется
`registry.register(name, schema)`; NestJS-контроллер ссылается на тип через `z.infer<typeof Schema>`
(Charter §3.1).

**SRS-API-061** Живая спека доступна разработчику на `GET /api/docs/json` (сырой JSON) и
`GET /api/docs` (Swagger UI) — ОБА эндпоинта отключены (`404`) когда `NODE_ENV=production` И
`ENABLE_API_DOCS != true` (по умолчанию выключено в проде, включается ENV-флагом для контролируемого
временного доступа, не публично постоянно).

**SRS-API-062** На каждый релизный тег CI-джоба генерирует спеку и коммитит
`docs/api/openapi.json` (Charter §3.2 «единый источник правды для Dart-клиента»). Проверка «спека не
устарела» — отдельный CI-шаг `pnpm openapi:check` (генерирует в temp-файл, `diff` с закоммиченным;
расхождение → красный CI, разработчик обязан закоммитить актуальную спеку вместе с изменением кода,
не полагаясь на «сгенерируется само при деплое»).

**SRS-API-063** Dart-клиент: `pnpm generate:dart-client` запускает
`openapi-generator-cli generate -i docs/api/openapi.json -g dart-dio -o packages_dart/dorutj_api`
(генератор `dart-dio` — совместим с `dio`-интерцепторами Flutter-приложений, `01-TECH-BASELINE.md`).
Сгенерированный код КОММИТИТСЯ в репозиторий (не генерируется в CI Flutter-сборки «на лету» — детерминизм
сборки, офлайн-разработка без сети). Запуск — вручную разработчиком после мержа изменений контракта
ИЛИ отдельным CI-джобом на релизный тег, открывающим PR с обновлённым `packages_dart/dorutj_api` для
ручного ревью (не auto-merge — сгенерированный клиент может содержать breaking changes для
Flutter-кода, требует внимания).

---

## 9. Безопасность транспорта

**SRS-API-064** [Charter §5] `@fastify/helmet` включён глобально: `Content-Security-Policy` (default
`default-src 'self'`), `Strict-Transport-Security` (`max-age=31536000; includeSubDomains`),
`X-Content-Type-Options: nosniff`, `X-Frame-Options` — ПЕРЕОПРЕДЕЛЁН на маршрутах, обслуживающих
Telegram Mini App (`frame-ancestors https://web.telegram.org https://*.telegram.org`, вместо
глобального `DENY`) — Telegram встраивает TWA в `iframe`, дефолтный `DENY` сломал бы CUJ-8/TWA-режим
(REQ-TG).

**SRS-API-065** CORS — allowlist, НЕ `*`. Источники: (1) статический список из ENV
`CORS_STATIC_ORIGINS` (домены платформы: `https://dorutj.com`, `https://admin.dorutj.com`,
`http://localhost:*` только при `NODE_ENV=development`); (2) ДИНАМИЧЕСКИЙ список — `custom_domain`
активных тенантов из БД (кэш `Redis`, TTL `CORS_ORIGIN_CACHE_TTL_SECONDS`, ASSUMPTION 60) — White-Label
домен добавляется через админку «без деплоя» (Charter §3.4), поэтому статичного ENV-списка
недостаточно, CORS-мидлварь обязан проверять Origin И против БД, не только против конфиг-файла.
Origin вне обоих списков → браузер блокирует запрос стандартным CORS-механизмом (сервер не отправляет
`Access-Control-Allow-Origin` для незнакомого Origin), обычный HTTP-статус при этом всё равно
возвращается (для non-CORS клиентов типа 1С/мобильных — CORS не применяется, они не браузеры).

**SRS-API-066** Лимиты размера тела: JSON — `1 MB` дефолт (`@fastify/rate-limit` не про размер,
размер — нативная опция Fastify `bodyLimit`); `multipart/form-data` (загрузка рецепта/аватара) —
`10 MB` (ASSUMPTION); `POST /api/v1/inventory/batch-update` — `5 MB` (REQ-SYNC-4, точное значение из
research, не ASSUMPTION) И `≤1000` позиций в массиве `items` (REQ-SYNC-4) — превышение любого лимита
→ `413 PAYLOAD_TOO_LARGE` до парсинга тела целиком (потоковая проверка `Content-Length`, не
буферизация превышающего лимит тела в память).

**SRS-API-067** Таймауты: HTTP-запрос к API — `REQUEST_TIMEOUT_MS` (ASSUMPTION 30000) на уровне
Fastify (`connectionTimeout`); вызов внешнего провайдера ИЗНУТРИ use case — отдельный, более короткий
таймаут per-provider (`PAYMENT_PROVIDER_TIMEOUT_MS=8000`, SRS-DOM-166; аналогично для
OCR/STT/SMS-провайдеров — конкретные ASSUMPTION-значения в SRS соответствующих доменных областей,
не дублируются здесь). Истечение общего HTTP-таймаута → `408 REQUEST_TIMEOUT` (не зависший сокет).

**SRS-API-068** Логирование (`pino` + `pino-http`, Charter §5): КАЖДАЯ запись включает `requestId`,
`tenantId`, `userId?`, `method`, `path` (БЕЗ query-строки, если она может содержать PII — см. ниже),
`statusCode`, `durationMs`. НИКОГДА не логируется (redaction — `pino` опция `redact`, список путей
JSON, применяется ДО сериализации, не постфактум маскирование строки):

| Что | Почему | Как обрабатывается вместо полного значения |
|---|---|---|
| `phone` (любое поле с номером) | PII | Маскируется: `+992******34` (код страны + 2 последние цифры) |
| `Authorization`, `refreshToken`, `X-Pharmacy-API-Key`, `X-Pharmacy-Signature` | Секреты сессии/ключи | Полностью опускаются (`"[REDACTED]"`) |
| `otp.code`, `code` в теле `/auth/otp/verify` | Короткоживущий секрет | Полностью опускается |
| `prescription_image_url`/любой `object storage` ключ фото рецепта | Медданные (REQ-REG-10/11) | Опускается из access-логов; доступ фиксируется ОТДЕЛЬНО в `audit_log` (не в транспортном логе), только факт обращения (`userId`, `prescriptionId`, `timestamp`), не сам URL/содержимое |
| Полное тело вебхука банка (номер карты, если банк его передаёт) | Платёжные данные | Логируется только `{ idempotencyKey, orderId, status }`, остальные поля явно исключены из сериализации перед `pino` |
| `password`/`secret`/`token` — любое поле с таким именем в теле запроса | Общее правило | Автоматический `redact`-паттерн по имени поля (glob `*.password`, `*.secret`, `*.token`, `*.hash`) |

**SRS-API-069** `query`-строка логируется ЦЕЛИКОМ только для эндпоинтов без потенциально
чувствительных фильтров; эндпоинты, где `filter[phone]=`/аналогичное теоретически возможно, обязаны
явно указать `sensitiveQueryParams` в декораторе маршрута для точечной редакции (не блокировать
логирование query целиком «на всякий случай» — теряется полезность трассировки).

---

## 10. Пограничные случаи и ошибки

**SRS-API-070** Истёкший access-токен в середине долгой операции (например, загрузка большого фото
рецепта, занявшая >15 минут на слабой сети) — сервер проверяет `exp` НА МОМЕНТ получения запроса
(не на момент начала), клиент получает `401 TOKEN_EXPIRED` после завершения аплоада данных (Fastify
не прерывает поток раньше срока) — впустую потраченный трафик признаётся приемлемым компромиссом
(частая проверка `exp` посреди стриминга усложняет реализацию непропорционально пользе); клиентская
рекомендация — обновлять токен превентивно за `TOKEN_REFRESH_LEAD_SECONDS` (ASSUMPTION 60) до `exp`
для длительных операций.

**SRS-API-071** Гонка двух вкладок браузера, обе вызывают `/auth/otp/verify` с одним и тем же
верным кодом почти одновременно (`otpRequestId` идентичен) — первая, дошедшая до БД, помечает
`consumed=true` внутри транзакции с блокировкой строки (`SELECT ... FOR UPDATE`); вторая получает
`400 OTP_MISMATCH` (уже потреблён, SRS-DOM-082) — НЕ трактуется как атака/лок (в отличие от 5
неверных попыток), пользователь просто перезапрашивает код, если действительно не залогинился ни в
одной вкладке (обычно первая вкладка уже успешно вошла — норм.сценарий, не ошибка UX).

**SRS-API-072** Telegram initData повторно отправлен ПОСЛЕ `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS`
(например, TWA не закрывался неделю, старый `initData` закэширован в localStorage клиента ошибочно)
— `401 TELEGRAM_AUTH_DATE_EXPIRED`; корректное клиентское поведение — ВСЕГДА получать свежий
`initData` из `window.Telegram.WebApp.initData` при каждом запуске/фокусе приложения, никогда не
кэшировать его самостоятельно (SDK Telegram сам выдаёt свежую строку на каждый запуск).

**SRS-API-073** DNS кастомного домена тенанта указывает на инфраструктуру DoruTJ, но
`tenants.custom_domain` ещё не создан/уже удалён (сеть приостановила White-Label-подписку) — Host не
резолвится на шаге 1 (§5.1), запрос падает в шаг 2/3 (X-Tenant-Slug/neutral) — пользователь видит
НЕЙТРАЛЬНЫЙ публичный маркетплейс на брендированном домене (не ошибку) — `pino.warn` пишется с
пометкой `domain_resolution_fallback` для операционного алерта (несоответствие DNS и конфигурации —
эксплуатационная проблема, не пользовательская ошибка, UX не должен показывать техническую ошибку
за неправильно настроенный DNS клиента).

**SRS-API-074** 1С отправляет два батча почти одновременно с РАЗНЫМИ `X-Pharmacy-Nonce`, но по сути
дублирующие данные (ошибка на стороне 1С-модуля клиента, не архитектурная гонка) — оба проходят
HMAC-проверку независимо (нет технической коллизии, nonce разные) — дедупликация на этом уровне НЕ
предусмотрена (это ответственность `batch_id`-идемпотентности, SRS-DOM-168, а не транспортного
уровня — данный документ отвечает только за аутентификацию запроса, не за бизнес-идемпотентность
батча).

**SRS-API-075** WS-клиент отправляет `subscribe` на несуществующую комнату (опечатка в id) —
трактуется как `WS_ROOM_FORBIDDEN` (не различается «комната не существует» и «комната существует, но
запрещена» — не даём клиенту способ перебором узнавать существующие `pharmacyId` через различие
ошибок).

**SRS-API-076** Клиент повторяет мутирующий запрос с `Idempotency-Key`, но ПОСЛЕ истечения
`IDEMPOTENCY_KEY_TTL_HOURS` (24 часа) — запись в `idempotency_keys` уже удалена фоновой job'ой
очистки — запрос обрабатывается КАК НОВЫЙ (полное повторное выполнение use case) — если это
действительно повтор старого намерения клиента (редкий кейс — 24 часа спустя), результатом может
стать легитимный новый заказ/операция, а не ошибка — это осознанный компромисс (бессрочное хранение
ключей идемпотентности неограниченно растит таблицу без пользы для реального UX-сценария «двойной
тап», который происходит в течение секунд-минут, не суток).

---

## Тестовые сценарии

| TC | Проверяет | Given | When | Then |
|---|---|---|---|---|
| TC-API-001 | SRS-API-004/005 | Список заказов, 25 строк, `limit=20` | `GET /orders?limit=20` затем `GET /orders?cursor=<next>&limit=20` | Вторая страница возвращает оставшиеся 5, `hasMore=false`, без дублей/пропусков относительно первой |
| TC-API-002 | SRS-API-005 | Курсор с `v` типа `number` для эндпоинта, где `sort` — ISO-дата | Запрос с этим курсором | `400 INVALID_CURSOR` |
| TC-API-003 | SRS-API-009/010 | `POST /orders` с `Idempotency-Key=K`, запрос уже завершён с `201` | Повтор того же тела с тем же `K` | Возвращён ТОТ ЖЕ `201` и то же тело, заказ не задублирован (проверяется отсутствием второй строки `orders`) |
| TC-API-004 | SRS-API-010 | Тот же `K`, но другое тело (`items` отличаются) | Повторный запрос | `409 IDEMPOTENCY_KEY_CONFLICT` |
| TC-API-005 | SRS-API-009 | `POST /orders` без заголовка `Idempotency-Key` | Запрос | `400 IDEMPOTENCY_KEY_REQUIRED` |
| TC-API-006 | SRS-API-012/013 | 429-й запрос на анонимный лимит `100/мин` с одного IP | Запрос | `429 RATE_LIMITED`, заголовок `Retry-After` присутствует и > 0 |
| TC-API-018 | SRS-API-021/022 | `otpRequestId=X`, 5 неверных попыток verify | 6-я попытка (даже с верным кодом) | `423 OTP_LOCKED`, код не проверяется |
| TC-API-019 | SRS-API-023 | Верный код, `otpRequestId=X`, уже `consumed=true` | Повторный `verify` с тем же `otpRequestId` и верным кодом | `400 OTP_MISMATCH` |
| TC-API-020 | SRS-API-019 | 3 запроса кода на один `phone` за 10 минут уже сделаны | 4-й запрос в пределах того же окна | `429 OTP_REQUEST_RATE_LIMITED` |
| TC-API-021 | SRS-API-026/027 | Refresh token `R1` использован для ротации (выдан `R2`), `R1` теперь `rotated_at != null` | Повторный `/auth/refresh` с `R1` | Вся `family_id`-цепочка отозвана, `401 REFRESH_TOKEN_REUSE_DETECTED`, `R2` тоже больше не валиден |
| TC-API-022 | SRS-API-028 | Refresh token с `absoluteExpiresAt` в прошлом, не переиспользован | `/auth/refresh` | `401 REFRESH_TOKEN_INVALID` (не `REUSE_DETECTED`) |
| TC-API-023 | SRS-API-031 | `initData` с изменённым полем `user.id` после подписи (хэш не пересчитан) | `POST /auth/telegram` | `401 INVALID_TELEGRAM_INIT_DATA` |
| TC-API-024 | SRS-API-031 | Валидная подпись, `auth_date = now() - 400s` | `POST /auth/telegram` | `401 TELEGRAM_AUTH_DATE_EXPIRED` |
| TC-API-025 | SRS-API-033 | Корректный `keyId`/`secret`, но `X-Pharmacy-Timestamp` на 10 минут в прошлом | `POST /inventory/batch-update` | `401 PHARMACY_TIMESTAMP_OUT_OF_WINDOW` |
| TC-API-026 | SRS-API-033 шаг 6 | Тот же `X-Pharmacy-Nonce`, отправленный дважды в течение 5 минут | Второй запрос | `401 PHARMACY_REQUEST_REPLAYED` |
| TC-API-027 | SRS-API-033 шаг 9 | Тело подписано корректно, но изменено ПОСЛЕ подписи (MITM-имитация в тесте) | Запрос с изменённым телом, старой подписью | `401 PHARMACY_SIGNATURE_INVALID` |
| TC-API-028 | SRS-API-033 шаг 4 | `pharmacy_api_keys.require_mtls=true`, запрос без клиентского сертификата | Запрос | `401 MTLS_REQUIRED` |
| TC-API-029 | SRS-API-039 | JWT роли `pharmacy_admin` | `POST /disputes/:id/resolve-refund-full` | `403 INSUFFICIENT_ROLE` (маршрут вне `@Roles` набора) |
| TC-API-030 | SRS-API-046, Charter §3.4 (обязательный тест изоляции) | Заказ `O1` тенанта A, JWT пользователя тенанта B | `GET /orders/O1` через домен/slug тенанта B | `404 NOT_FOUND` (не `403`, не раскрывает существование) |
| TC-API-031 | SRS-API-041 шаг 2 | `X-Tenant-Slug: definitely-not-a-real-slug`, Host не резолвится | Запрос | `404 UNKNOWN_TENANT_SLUG` (не молчаливый `neutral`) |
| TC-API-032 | SRS-API-045 | JWT `tenantId=A`, роль `customer`, запрос через домен тенанта B | Любой защищённый эндпоинт | `403 CROSS_TENANT_ACCESS_DENIED` до входа в контроллер |
| TC-API-033 | SRS-API-044 | JWT `super_admin`, `tenantId=null`, `X-Tenant-Slug` указывает на тенант B | Запрос к ресурсу тенанта B | Доступ разрешён, `audit_log` содержит запись `crossTenantOverride=true` |
| TC-API-034 | SRS-API-049 | WS-соединение открыто, кадр `auth` не отправлен за 5 секунд | Таймаут истёк | Соединение закрыто кодом `4401` |
| TC-API-035 | SRS-API-050 | WS-соединение открыто с access-токеном, `exp` наступает | Момент `exp` | Сервер закрывает соединение кодом `4401` без ожидания следующего события |
| TC-API-036 | SRS-API-051 | Роль `customer`, кадр `{"type":"subscribe","room":"pharmacy:X"}` | Отправка кадра | `{"type":"error","code":"WS_ROOM_FORBIDDEN"}`, соединение НЕ закрыто |
| TC-API-037 | SRS-API-052 | 2 подряд пропущенных `pong` | Второй таймаут heartbeat | Соединение закрыто кодом `4408` |
| TC-API-038 | SRS-API-057 | `tenant_settings.codLimitDiram` изменён в админке | `GET /meta` с устаревшим `If-None-Match` | Возвращён `200` с новым `metaVersion` и новым значением `config.codLimitDiram`, не `304` |
| TC-API-039 | SRS-API-058 | `GET /i18n/de` (неподдерживаемая локаль) | Запрос | `404 UNSUPPORTED_LOCALE` |
| TC-API-040 | SRS-API-059 | `TenantBrandingUpdatedEvent` опубликован для тенанта X | Клиент, подключённый к WS тенанта X | Получает `tenant.branding_updated`, следующий `GET /tenant/branding` возвращает новый `ETag` |
| TC-API-041 | SRS-API-062 | Изменена Zod-схема в `packages/contracts`, `docs/api/openapi.json` НЕ перегенерирован/не закоммичен | CI-джоба `pnpm openapi:check` | Красный CI (diff обнаружен) |
| TC-API-042 | SRS-API-065 | `Origin: https://evil.example.com`, не входит ни в статический, ни в динамический список | Кросс-доменный запрос из браузера | Ответ не содержит `Access-Control-Allow-Origin`, браузер блокирует чтение ответа |
| TC-API-043 | SRS-API-066 | `POST /inventory/batch-update` с телом 6 МБ | Запрос | `413 PAYLOAD_TOO_LARGE` до полного разбора JSON |
| TC-API-044 | SRS-API-068 | Запрос `POST /auth/otp/verify` с `phone` и `code` в теле | Проверка структурного лога этого запроса | `phone` замаскирован (`+992******34`), `code` полностью отсутствует в записи лога |
| TC-API-045 | SRS-API-068 | `super_admin` открывает `GET /prescriptions/:id/image` | Просмотр изображения рецепта | Запись в `audit_log` с `userId`, `prescriptionId`, `timestamp`; ни один транспортный access-лог не содержит сам URL/содержимое файла |

---

**Итог**: документ вводит 76 требований `SRS-API-001..076` (конвенции REST, единый envelope и
полный каталог транспортных/auth/tenancy кодов ошибок сверх `10-domain-model.md`, четыре
`AuthProvider` — OTP/Telegram/1С-HMAC/Flutter-переиспользование OTP, RBAC-матрицу 6 ролей ×
27 permission-строк, алгоритм резолвинга тенанта с гарантией изоляции, полный каталог
realtime-событий канала `/api/v1/realtime`, конвенции мета-эндпоинтов, генерацию OpenAPI/Dart-клиента
и правила транспортной безопасности/логирования) и 45 тестовых сценариев `TC-API-001..045`,
обязательных для тикетов Tech Lead по модулям `identity`, `tenancy`, `notifications` (WS-слой) и для
`presentation`-слоя ВСЕХ остальных модулей (guard'ы, DTO envelope, коды ошибок). Любое расхождение
нижестоящих SRS-документов с этим документом или с `10-domain-model.md` разрешается ТОЛЬКО через ADR.
