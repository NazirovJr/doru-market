/**
 * Единый каталог кодов ошибок платформы DoruTJ.
 *
 * Источники (единственные, транскрипция без додумывания, DTJ-005):
 * - `docs/spec/12-api-conventions-auth-tenancy.md` §2.1 — транспортные/auth/tenancy коды;
 * - `docs/spec/10-domain-model.md` §«Доменные ошибки» — доменные коды и их HTTP-статусы.
 *
 * ОДИН enum на весь каталог (не два пересекающихся адресных пространства строк, см. риски
 * тикета DTJ-005): код, переиспользуемый обоими источниками (например `VALIDATION_ERROR`,
 * `CONFLICT`, `NOT_FOUND`, `BUSINESS_RULE_VIOLATION`, `CONSENT_REQUIRED`,
 * `INVALID_WEBHOOK_SIGNATURE`, `OTP_LOCKED`), объявлен здесь один раз.
 *
 * `ERROR_HTTP_STATUS` — HTTP-статус хранится РЯДОМ с каталогом (не в `domain-errors.ts`), т.к.
 * им пользуется и `TransportExceptionFilter`, и `DomainExceptionFilter` (оба — DTJ-018).
 * `Record<ErrorCode, number>` заставляет TS требовать статус для КАЖДОГО члена enum — это и есть
 * "тест-сверка" критерия приёмки №1, проверяемая компилятором, а не только unit-тестом.
 */

export enum ErrorCode {
  // ---- Транспорт/валидация (400) — `12-api-conventions-auth-tenancy.md` §2.1 ----
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  IDEMPOTENCY_KEY_REQUIRED = 'IDEMPOTENCY_KEY_REQUIRED',
  INVALID_CURSOR = 'INVALID_CURSOR',
  TENANT_NOT_RESOLVED = 'TENANT_NOT_RESOLVED',
  CONSENT_REQUIRED = 'CONSENT_REQUIRED',

  // ---- Аутентификация (401) ----
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  REFRESH_TOKEN_INVALID = 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_REUSE_DETECTED = 'REFRESH_TOKEN_REUSE_DETECTED',
  INVALID_TELEGRAM_INIT_DATA = 'INVALID_TELEGRAM_INIT_DATA',
  TELEGRAM_AUTH_DATE_EXPIRED = 'TELEGRAM_AUTH_DATE_EXPIRED',
  PHARMACY_API_KEY_INVALID = 'PHARMACY_API_KEY_INVALID',
  PHARMACY_SIGNATURE_INVALID = 'PHARMACY_SIGNATURE_INVALID',
  PHARMACY_TIMESTAMP_OUT_OF_WINDOW = 'PHARMACY_TIMESTAMP_OUT_OF_WINDOW',
  PHARMACY_REQUEST_REPLAYED = 'PHARMACY_REQUEST_REPLAYED',
  MTLS_REQUIRED = 'MTLS_REQUIRED',
  INVALID_WEBHOOK_SIGNATURE = 'INVALID_WEBHOOK_SIGNATURE',

  // ---- Авторизация/tenancy (403) ----
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_ROLE = 'INSUFFICIENT_ROLE',
  TENANT_SUSPENDED = 'TENANT_SUSPENDED',
  CROSS_TENANT_ACCESS_DENIED = 'CROSS_TENANT_ACCESS_DENIED',
  WS_ROOM_FORBIDDEN = 'WS_ROOM_FORBIDDEN',

  // ---- Не найдено (404) ----
  NOT_FOUND = 'NOT_FOUND',
  UNKNOWN_TENANT_SLUG = 'UNKNOWN_TENANT_SLUG',
  UNSUPPORTED_LOCALE = 'UNSUPPORTED_LOCALE',

  // ---- Транспорт (408/409/413/415) ----
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
  CONFLICT = 'CONFLICT',
  IDEMPOTENCY_KEY_CONFLICT = 'IDEMPOTENCY_KEY_CONFLICT',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',

  // ---- Бизнес-правила / rate limit (422/423/429) ----
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  OTP_LOCKED = 'OTP_LOCKED',
  OTP_REQUEST_RATE_LIMITED = 'OTP_REQUEST_RATE_LIMITED',
  RATE_LIMITED = 'RATE_LIMITED',

  // ---- Сервер (500/501/502/503) ----
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  // NOT_IMPLEMENTED — DTJ-233 (EP-09): заглушка GET /orders/:id/payment-status до готовности
  // EP-10 (DTJ-242) — маршрут существует с первого дня для фронтенда (DTJ-235), но реальных
  // данных ещё нет. Новый код в конец каталога (D-27), тот же класс добавления, что
  // PRICE_OR_STOCK_CHANGED/NO_ORDERABLE_ITEMS (D-EP09-9).
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  BAD_GATEWAY = 'BAD_GATEWAY',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',

  // ---- Доменные: ValidationError — `10-domain-model.md` §«Доменные ошибки» (400) ----
  INVALID_PHONE_FORMAT = 'INVALID_PHONE_FORMAT',
  INVALID_COORDINATES = 'INVALID_COORDINATES',
  ORDER_TOTAL_MISMATCH = 'ORDER_TOTAL_MISMATCH',
  // ORDER_PHARMACY_MISMATCH — DTJ-221 (EP-09), SRS-DOM-002: defensive-проверка «все позиции
  // заказа одной аптеки», ошибка в конец каталога (D-27), не найдена среди уже существующих кодов.
  ORDER_PHARMACY_MISMATCH = 'ORDER_PHARMACY_MISMATCH',
  INVALID_RESTOCK_QUANTITY = 'INVALID_RESTOCK_QUANTITY',
  INVALID_PRICE = 'INVALID_PRICE',
  MISSING_RESOLUTION_REASON = 'MISSING_RESOLUTION_REASON',
  AMBIGUOUS_DATE_FORMAT = 'AMBIGUOUS_DATE_FORMAT',

  // ---- Доменные: ConflictError (409) ----
  TENANT_SLUG_TAKEN = 'TENANT_SLUG_TAKEN',
  DOMAIN_TAKEN = 'DOMAIN_TAKEN',
  RETURN_ALREADY_ACTIVE = 'RETURN_ALREADY_ACTIVE',
  DISPUTE_ALREADY_ACTIVE = 'DISPUTE_ALREADY_ACTIVE',
  LEDGER_IMBALANCE = 'LEDGER_IMBALANCE',
  // PRICE_OR_STOCK_CHANGED — DTJ-231 (EP-09), SRS-ORD-023: цена/остаток на момент checkout
  // разошлись с `expectedTotalDiram`, который клиент подтвердил на экране — эта ГРУППА не
  // оформляется, живёт внутри `failedGroups`, не как транспортный код всего ответа
  // (`21-module-orders-payments-escrow.md` §2.2). Новый код в конец каталога (D-27), тот же
  // класс добавления, что NO_ORDERABLE_ITEMS/PAYMENT_METHOD_NOT_ENABLED (D-EP09-9).
  PRICE_OR_STOCK_CHANGED = 'PRICE_OR_STOCK_CHANGED',
  // ORDER_NOT_RETRYABLE — DTJ-241 (EP-10), SRS-PAY-041: POST /orders/:id/retry-payment на
  // заказе, который НЕ в pending_payment без payment_transaction_id (уже оплачен/отменён/
  // наличный) — новый код в конец каталога (D-27), тот же класс добавления, что
  // PRICE_OR_STOCK_CHANGED (D-EP09-9).
  ORDER_NOT_RETRYABLE = 'ORDER_NOT_RETRYABLE',

  // ---- Доменные: ForbiddenTransitionError (409) ----
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',

  // ---- Доменные: BusinessRuleViolationError и потомки (422, кроме отмеченных) ----
  PRESCRIPTION_NOT_VERIFIED = 'PRESCRIPTION_NOT_VERIFIED',
  CONTROLLED_SUBSTANCE_FORBIDDEN = 'CONTROLLED_SUBSTANCE_FORBIDDEN',
  EXPIRED_STOCK = 'EXPIRED_STOCK',
  COD_FORBIDDEN_FOR_RX = 'COD_FORBIDDEN_FOR_RX',
  COD_LIMIT_EXCEEDED = 'COD_LIMIT_EXCEEDED',
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  RESTOCK_CONDITIONS_NOT_MET = 'RESTOCK_CONDITIONS_NOT_MET',
  CONTROLLED_SUBSTANCE_MUST_BE_DESTROYED = 'CONTROLLED_SUBSTANCE_MUST_BE_DESTROYED',
  PARENT_CHAIN_NOT_ACTIVE = 'PARENT_CHAIN_NOT_ACTIVE',
  // NO_ORDERABLE_ITEMS — DTJ-227 (EP-09), SRS-ORD-016: после исключения неактивных
  // аптек/непокрытых Rx-позиций/провалов резерва не осталось ни одной группы для оформления —
  // ошибка в конец каталога (D-27), «новый код этого документа» по 21-module-orders-payments-escrow.md.
  NO_ORDERABLE_ITEMS = 'NO_ORDERABLE_ITEMS',
  // PAYMENT_METHOD_NOT_ENABLED — DTJ-229 (EP-09), SRS-ORD-025 п.2: `paymentMethod` не входит в
  // `tenantSettings.enabledPaymentMethods` — «новый код» по 21-module-orders-payments-escrow.md:336,
  // тот же класс добавления, что NO_ORDERABLE_ITEMS/ORDER_PHARMACY_MISMATCH (D-EP09-9).
  PAYMENT_METHOD_NOT_ENABLED = 'PAYMENT_METHOD_NOT_ENABLED',
  PHARMACY_SUSPENDED = 'PHARMACY_SUSPENDED', // 403
  CASH_AMOUNT_MISMATCH = 'CASH_AMOUNT_MISMATCH',
  COURIER_TENANT_MISMATCH = 'COURIER_TENANT_MISMATCH', // 403
  COURIER_NOT_ELIGIBLE = 'COURIER_NOT_ELIGIBLE',
  SELF_DEALING_FORBIDDEN = 'SELF_DEALING_FORBIDDEN', // 403
  TENANT_CONFIRMATION_PENDING = 'TENANT_CONFIRMATION_PENDING', // 409
  PAYOUT_ON_HOLD = 'PAYOUT_ON_HOLD', // 409
  CHAIN_APPLICATION_ALREADY_EXISTS = 'CHAIN_APPLICATION_ALREADY_EXISTS', // 409 [SRS-ADM-007, EP-03]
  ALREADY_REVIEWED = 'ALREADY_REVIEWED', // 409 [SRS-ADM-080, EP-03]

  // ---- Доменные: delivery — модуль 25 §A.9 (EP-13, DTJ-313). Новые коды в конец каталога (D-27) ----
  OFFER_EXPIRED = 'OFFER_EXPIRED', // 409 [SRS-DELIV-013]
  OFFER_ALREADY_RESPONDED = 'OFFER_ALREADY_RESPONDED', // 409 [SRS-DELIV-013]
  ASSIGNMENT_ALREADY_CLAIMED = 'ASSIGNMENT_ALREADY_CLAIMED', // 409 [SRS-DELIV-016]
  SHIFT_ALREADY_ACTIVE = 'SHIFT_ALREADY_ACTIVE', // 409 [SRS-DELIV-028]
  RATING_ALREADY_SUBMITTED = 'RATING_ALREADY_SUBMITTED', // 409 [SRS-DELIV-032]
  // DELIVERY_ASSIGNMENT_ALREADY_ACTIVE — не в таблице §A.9 (тикет DTJ-313 её не называет), но
  // требуется SRS-DOM-036 (`DeliveryAssignment.create()` отклоняет дубль нетерминального
  // назначения на orderId, АС3 тикета) — источник не даёт готового имени класса/кода для ЭТОГО
  // конкретного случая; заведён по аналогии с уже существующими `RETURN_ALREADY_ACTIVE`/
  // `DISPUTE_ALREADY_ACTIVE` (тот же класс ошибки «дубль нетерминальной записи»), ASSUMPTION.
  DELIVERY_ASSIGNMENT_ALREADY_ACTIVE = 'DELIVERY_ASSIGNMENT_ALREADY_ACTIVE', // 409 [SRS-DOM-036]
  COURIER_NOT_ON_SHIFT = 'COURIER_NOT_ON_SHIFT', // 422 [SRS-DELIV-038]
  COURIER_AT_CAPACITY = 'COURIER_AT_CAPACITY', // 422 [SRS-DELIV-038]
  DELIVERY_ZONE_NOT_COVERED = 'DELIVERY_ZONE_NOT_COVERED', // 422 [SRS-DELIV-048]
  DELIVERY_MIN_ORDER_NOT_MET = 'DELIVERY_MIN_ORDER_NOT_MET', // 422 [SRS-DELIV-048]
  COLD_CHAIN_BAG_NOT_CONFIRMED = 'COLD_CHAIN_BAG_NOT_CONFIRMED', // 422 [SRS-DELIV-020]
  NO_ACTIVE_SHIFT = 'NO_ACTIVE_SHIFT', // 422 [SRS-DELIV-027/021]
  ACTIVE_ASSIGNMENT_BLOCKS_SHIFT_END = 'ACTIVE_ASSIGNMENT_BLOCKS_SHIFT_END', // 422 [SRS-DELIV-029]
  CONTACT_ATTEMPTS_INSUFFICIENT = 'CONTACT_ATTEMPTS_INSUFFICIENT', // 422 [SRS-DELIV-025]

  // ---- Доменные: SecurityError и потомки (401/403) ----
  UNAUTHORIZED_ADJUSTMENT = 'UNAUTHORIZED_ADJUSTMENT', // 403
  PHARMACY_NOT_IN_CHAIN_SCOPE = 'PHARMACY_NOT_IN_CHAIN_SCOPE', // 403 [SRS-ADM-046, EP-05 DTJ-142/156]

  // ---- Доменные: OtpError и потомки (400/423) ----
  OTP_EXPIRED = 'OTP_EXPIRED',
  OTP_MISMATCH = 'OTP_MISMATCH',

  // ---- Доменные: ExternalIntegrationError и потомки (503) ----
  PAYMENT_PROVIDER_UNAVAILABLE = 'PAYMENT_PROVIDER_UNAVAILABLE',
  OCR_PROVIDER_UNAVAILABLE = 'OCR_PROVIDER_UNAVAILABLE',
  SMS_PROVIDER_UNAVAILABLE = 'SMS_PROVIDER_UNAVAILABLE',

  // WEBHOOK_PROVIDER_UNKNOWN — DTJ-242 (EP-10), SRS-PAY-019: `X-Payment-Provider` заголовок
  // `POST /api/v1/payments/webhook` не зарегистрирован ни одним `BankWebhookVerifierPort`-
  // адаптером — тело НЕ обрабатывается вовсе (ни HMAC, ни JSON.parse). Новый код в конец
  // каталога (D-27), тот же класс добавления, что ORDER_NOT_RETRYABLE (D-EP09-9).
  WEBHOOK_PROVIDER_UNKNOWN = 'WEBHOOK_PROVIDER_UNKNOWN',

  // UNSUPPORTED_RETURN_REASON — DTJ-271 (EP-11), SRS-RET-003: `reason='undelivered'` не создаёт
  // `OrderReturn` — обрабатывается через `SupportFacade`/будущий `OrderDispute`, не через
  // возврат. Решение CTO D-EP11-5 (`reports/EP11-EP14-CTO-BRIEF.md`): обобщённый
  // `BUSINESS_RULE_VIOLATION` не годится — клиенту нужно отличить «эта причина обслуживается
  // другим процессом» от прочих отказов. Новый код в конец каталога (D-27), тот же класс
  // добавления, что WEBHOOK_PROVIDER_UNKNOWN.
  UNSUPPORTED_RETURN_REASON = 'UNSUPPORTED_RETURN_REASON',

  // ---- Доменные: модуль 24 «Терминал фармацевта» (DTJ-300, EP-12) — новые коды в конец
  // каталога (D-27), тот же класс добавления, что PRICE_OR_STOCK_CHANGED/ORDER_NOT_RETRYABLE
  // (D-EP09-9). Источник — `docs/spec/24-module-pharmacy-terminal.md` §«Дополнения к схеме
  // БД», таблица «Новые доменные ошибки». ----
  ORDER_ALREADY_CLAIMED = 'ORDER_ALREADY_CLAIMED', // 409, SRS-PHT-009
  ORDER_ITEM_NOT_FOUND = 'ORDER_ITEM_NOT_FOUND', // 404, SRS-PHT-012
  ITEM_ALREADY_SCANNED = 'ITEM_ALREADY_SCANNED', // 409, SRS-PHT-013
  BATCH_NOT_AVAILABLE = 'BATCH_NOT_AVAILABLE', // 422, SRS-PHT-014
  SEAL_CONFIRMATION_REQUIRED = 'SEAL_CONFIRMATION_REQUIRED', // 400, SRS-PHT-025
  PARTIAL_FULFILLMENT_PENDING = 'PARTIAL_FULFILLMENT_PENDING', // 409, SRS-PHT-026
  HANDOVER_OTP_NOT_FOUND = 'HANDOVER_OTP_NOT_FOUND', // 404, SRS-PHT-028

  // ---- Доменные: EP-05 inventory (DTJ-160/161) — новый код в конец каталога (D-27).
  // Excel/CSV-импорт остатков: файл структурно не соответствует шаблону (отсутствует
  // обязательная колонка заголовка) — весь файл отклоняется ДО построчной обработки. Это
  // НЕ построчный `inventory_sync_row_error_code` (тот не HTTP-код вовсе, живёт только в
  // `inventory_sync_errors.error_code`, см. `docs/spec/22-module-inventory-sync-1c.md`
  // SRS-INV-013/014). ----
  EXCEL_TEMPLATE_HEADER_MISMATCH = 'EXCEL_TEMPLATE_HEADER_MISMATCH', // 400, SRS-INV-014
  // Файл превышает `EXCEL_IMPORT_MAX_ROWS` строк (ASSUMPTION 20000) — тоже отклоняется
  // целиком ДО построчного разбора (структурная ошибка, не построчная), DTJ-160.
  EXCEL_IMPORT_ROW_LIMIT_EXCEEDED = 'EXCEL_IMPORT_ROW_LIMIT_EXCEEDED', // 400, SRS-INV-014

  // ---- Доменные: модуль support (DTJ-282, EP-14, SRS-ADM-076) — новые коды в конец
  // каталога (D-27), тот же класс добавления, что модуль 24. Ни один из трёх не найден
  // среди уже существующих кодов (`TicketNotFoundError`/`TicketAlreadyTerminalError`/
  // `InvalidTicketStatusTransitionError`, DTJ-278, ранее локальные `Error`-потомки —
  // централизованы здесь, см. `domain-errors-support.ts`). ----
  TICKET_NOT_FOUND = 'TICKET_NOT_FOUND', // 404
  TICKET_ALREADY_TERMINAL = 'TICKET_ALREADY_TERMINAL', // 409
  INVALID_TICKET_STATUS_TRANSITION = 'INVALID_TICKET_STATUS_TRANSITION', // 409
}

/** HTTP-статус для каждого `ErrorCode` (`AllExceptionsFilter`, DTJ-018 — единственный фильтр приложения). */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.IDEMPOTENCY_KEY_REQUIRED]: 400,
  [ErrorCode.INVALID_CURSOR]: 400,
  [ErrorCode.TENANT_NOT_RESOLVED]: 400,
  [ErrorCode.CONSENT_REQUIRED]: 400,

  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.TOKEN_INVALID]: 401,
  [ErrorCode.REFRESH_TOKEN_INVALID]: 401,
  [ErrorCode.REFRESH_TOKEN_REUSE_DETECTED]: 401,
  [ErrorCode.INVALID_TELEGRAM_INIT_DATA]: 401,
  [ErrorCode.TELEGRAM_AUTH_DATE_EXPIRED]: 401,
  [ErrorCode.PHARMACY_API_KEY_INVALID]: 401,
  [ErrorCode.PHARMACY_SIGNATURE_INVALID]: 401,
  [ErrorCode.PHARMACY_TIMESTAMP_OUT_OF_WINDOW]: 401,
  [ErrorCode.PHARMACY_REQUEST_REPLAYED]: 401,
  [ErrorCode.MTLS_REQUIRED]: 401,
  [ErrorCode.INVALID_WEBHOOK_SIGNATURE]: 401,

  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.INSUFFICIENT_ROLE]: 403,
  [ErrorCode.TENANT_SUSPENDED]: 403,
  [ErrorCode.CROSS_TENANT_ACCESS_DENIED]: 403,
  [ErrorCode.WS_ROOM_FORBIDDEN]: 403,

  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.UNKNOWN_TENANT_SLUG]: 404,
  [ErrorCode.UNSUPPORTED_LOCALE]: 404,

  [ErrorCode.REQUEST_TIMEOUT]: 408,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.IDEMPOTENCY_KEY_CONFLICT]: 409,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 415,

  [ErrorCode.BUSINESS_RULE_VIOLATION]: 422,
  [ErrorCode.OTP_LOCKED]: 423,
  [ErrorCode.OTP_REQUEST_RATE_LIMITED]: 429,
  [ErrorCode.RATE_LIMITED]: 429,

  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.NOT_IMPLEMENTED]: 501,
  [ErrorCode.BAD_GATEWAY]: 502,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,

  [ErrorCode.INVALID_PHONE_FORMAT]: 400,
  [ErrorCode.INVALID_COORDINATES]: 400,
  [ErrorCode.ORDER_TOTAL_MISMATCH]: 400,
  [ErrorCode.ORDER_PHARMACY_MISMATCH]: 400,
  [ErrorCode.INVALID_RESTOCK_QUANTITY]: 400,
  [ErrorCode.INVALID_PRICE]: 400,
  [ErrorCode.MISSING_RESOLUTION_REASON]: 400,
  [ErrorCode.AMBIGUOUS_DATE_FORMAT]: 400,

  [ErrorCode.TENANT_SLUG_TAKEN]: 409,
  [ErrorCode.DOMAIN_TAKEN]: 409,
  [ErrorCode.RETURN_ALREADY_ACTIVE]: 409,
  [ErrorCode.DISPUTE_ALREADY_ACTIVE]: 409,
  [ErrorCode.LEDGER_IMBALANCE]: 409,
  [ErrorCode.PRICE_OR_STOCK_CHANGED]: 409,
  [ErrorCode.ORDER_NOT_RETRYABLE]: 409,

  [ErrorCode.INVALID_STATE_TRANSITION]: 409,

  [ErrorCode.PRESCRIPTION_NOT_VERIFIED]: 422,
  [ErrorCode.CONTROLLED_SUBSTANCE_FORBIDDEN]: 422,
  [ErrorCode.EXPIRED_STOCK]: 422,
  [ErrorCode.COD_FORBIDDEN_FOR_RX]: 422,
  [ErrorCode.COD_LIMIT_EXCEEDED]: 422,
  [ErrorCode.INSUFFICIENT_STOCK]: 422,
  [ErrorCode.RESTOCK_CONDITIONS_NOT_MET]: 422,
  [ErrorCode.CONTROLLED_SUBSTANCE_MUST_BE_DESTROYED]: 422,
  [ErrorCode.PARENT_CHAIN_NOT_ACTIVE]: 422,
  [ErrorCode.NO_ORDERABLE_ITEMS]: 422,
  [ErrorCode.PAYMENT_METHOD_NOT_ENABLED]: 422,
  [ErrorCode.PHARMACY_SUSPENDED]: 403,
  [ErrorCode.CASH_AMOUNT_MISMATCH]: 422,
  [ErrorCode.COURIER_TENANT_MISMATCH]: 403,
  [ErrorCode.COURIER_NOT_ELIGIBLE]: 422,
  [ErrorCode.SELF_DEALING_FORBIDDEN]: 403,
  [ErrorCode.TENANT_CONFIRMATION_PENDING]: 409,
  [ErrorCode.PAYOUT_ON_HOLD]: 409,
  [ErrorCode.CHAIN_APPLICATION_ALREADY_EXISTS]: 409,
  [ErrorCode.ALREADY_REVIEWED]: 409,

  [ErrorCode.OFFER_EXPIRED]: 409,
  [ErrorCode.OFFER_ALREADY_RESPONDED]: 409,
  [ErrorCode.ASSIGNMENT_ALREADY_CLAIMED]: 409,
  [ErrorCode.SHIFT_ALREADY_ACTIVE]: 409,
  [ErrorCode.RATING_ALREADY_SUBMITTED]: 409,
  [ErrorCode.DELIVERY_ASSIGNMENT_ALREADY_ACTIVE]: 409,
  [ErrorCode.COURIER_NOT_ON_SHIFT]: 422,
  [ErrorCode.COURIER_AT_CAPACITY]: 422,
  [ErrorCode.DELIVERY_ZONE_NOT_COVERED]: 422,
  [ErrorCode.DELIVERY_MIN_ORDER_NOT_MET]: 422,
  [ErrorCode.COLD_CHAIN_BAG_NOT_CONFIRMED]: 422,
  [ErrorCode.NO_ACTIVE_SHIFT]: 422,
  [ErrorCode.ACTIVE_ASSIGNMENT_BLOCKS_SHIFT_END]: 422,
  [ErrorCode.CONTACT_ATTEMPTS_INSUFFICIENT]: 422,

  [ErrorCode.UNAUTHORIZED_ADJUSTMENT]: 403,
  [ErrorCode.PHARMACY_NOT_IN_CHAIN_SCOPE]: 403,

  [ErrorCode.OTP_EXPIRED]: 400,
  [ErrorCode.OTP_MISMATCH]: 400,

  [ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE]: 503,
  [ErrorCode.OCR_PROVIDER_UNAVAILABLE]: 503,
  [ErrorCode.SMS_PROVIDER_UNAVAILABLE]: 503,

  [ErrorCode.WEBHOOK_PROVIDER_UNKNOWN]: 400,

  [ErrorCode.UNSUPPORTED_RETURN_REASON]: 422,
  [ErrorCode.ORDER_ALREADY_CLAIMED]: 409,
  [ErrorCode.ORDER_ITEM_NOT_FOUND]: 404,
  [ErrorCode.ITEM_ALREADY_SCANNED]: 409,
  [ErrorCode.BATCH_NOT_AVAILABLE]: 422,
  [ErrorCode.SEAL_CONFIRMATION_REQUIRED]: 400,
  [ErrorCode.PARTIAL_FULFILLMENT_PENDING]: 409,
  [ErrorCode.HANDOVER_OTP_NOT_FOUND]: 404,

  [ErrorCode.EXCEL_TEMPLATE_HEADER_MISMATCH]: 400,
  [ErrorCode.EXCEL_IMPORT_ROW_LIMIT_EXCEEDED]: 400,

  [ErrorCode.TICKET_NOT_FOUND]: 404,
  [ErrorCode.TICKET_ALREADY_TERMINAL]: 409,
  [ErrorCode.INVALID_TICKET_STATUS_TRANSITION]: 409,
}
