# DoruTJ — Модуль 23: Рецепты, OCR и голосовой ввод (AI Medical Input)

> Владелец документа: Analyst (SRS). Статус: **BASELINE v1.0**.
> Покрывает: CUJ-5 (Рецепт/AI), CUJ-8 (Голосовой ввод), tz.log МОДУЛЬ 2 «OCR-распознавание
> рецептов и голосовых сообщений».
> Обязательное чтение перед этим документом: `00-PROJECT-CHARTER.md`, `01-TECH-BASELINE.md`,
> `02-CLEAN-ARCHITECTURE-AND-CODE.md`, `03-ARCHITECT-DECISIONS.md`, `04-SCOPE-DECISION-PIVOT.md`,
> `research/00-RESEARCH-DIGEST.md`, `tz.log`, `spec/10-domain-model.md`, `spec/11-database-schema.md`,
> `spec/12-api-conventions-auth-tenancy.md`.
> Приоритет при конфликте: **04-SCOPE-DECISION-PIVOT > 03-ARCHITECT-DECISIONS > 00-CHARTER >
> research > tz.log**. Данный документ НЕ переопределяет `10-domain-model.md`/`11-database-schema.md`/
> `12-api-conventions-auth-tenancy.md` — расширяет их, ссылаясь на существующие ID (`SRS-DOM-*`,
> `SRS-DB-*`, `SRS-API-*`) вместо дублирования. Новые требования этого документа — `SRS-RX-*`.

---

## Разбиение по релизам

> Основание: `04-SCOPE-DECISION-PIVOT.md` §4 (R2-4) и §2.2 («порт + Mock-провайдер = R1,
> реальный адаптер = R2/R3»). Полный объём модуля описан ниже одним документом; таблица показывает,
> что именно включено (реализовано и доступно пользователю) в каждом релизе.

| Компонент | R1 | R2 | R3 | Почему |
|---|---|---|---|---|
| `PrescriptionOcrProvider` — порт, Zod-контракт, `CompositeConfidenceCalculator` | ✅ реализовано и покрыто тестами | — | — | Порт и домен — архитектурное основание, ретрофит дороже (Pivot §2.2) |
| `MockOcrProvider` (детерминированный, фикстуры) | ✅ | — | — | Позволяет писать и тестировать весь флоу верификации без внешнего ключа (Charter DoD п.7) |
| `GeminiOcrProvider` (реальный адаптер, Gemini 2.5 Flash) | ❌ выключен (`OCR_DRIVER=mock`) | ✅ включается фиче-флагом `FEATURE_PRESCRIPTION_OCR_ENABLED` | — | Предусловие R2-4 Pivot: включение оправдано только если доля «фото рецепта → заказ» в ручном потоке R1 подтверждает автоматизацию |
| Загрузка рецепта, статусы `prescription_status`, ручная верификация фармацевтом БЕЗ автораспознавания (фото сохраняется, фармацевт вводит позиции вручную по фото) | ✅ (упрощённый флоу без OCR-конвейера: `uploaded → needs_clarification` сразу, фармацевт читает фото глазами) | ✅ (полный OCR-конвейер поверх той же схемы) | — | Rx-checkout обязан работать с первого дня (CUJ-5 гейтит `orders:create`), независимо от готовности AI |
| `SpeechToTextProvider` — порт, `MockSttProvider` | ✅ | — | — | Архитектурное основание |
| `WhisperSttProvider` (реальный адаптер) | ❌ (`STT_DRIVER=mock`) | ✅ фиче-флаг `FEATURE_VOICE_INPUT_ENABLED` | — | Тот же принцип — голос вторичный канал, включается по данным R1 |
| Голосовой ввод — UI-точка входа (кнопка микрофона) | ❌ скрыта (`FEATURE_VOICE_INPUT_ENABLED=false`) | ✅ | — | UI не показывает нерабочую/невключённую фичу |
| Предобработка изображения (deskew/бинаризация), предобработка аудио (ресемплинг 16kHz) | ✅ (инфраструктура готова, вызывается даже в R1 упрощённом флоу для единообразия хранения) | ✅ | — | Не зависит от внешнего провайдера |
| `prescription_items`, `voice_input_requests` (схема) | ✅ | ✅ | — | Ретрофит гранулярных таблиц после появления данных — дороже |

**Каждое требование ниже помечено `[R1]`, `[R2]` или `[R3]`.** Реквизиты порта/домена — `[R1]`
даже там, где реальный провайдер — `[R2]`, согласно принципу Pivot §2.2.

---

## 1. Обзор модуля

Модуль относится к ограниченному контексту **prescriptions** (`10-domain-model.md` §«Ограниченные
контексты», строка `prescriptions` → корень `Prescription`, фасад `PrescriptionsFacade`). Голосовой
ввод — новая функциональная зона внутри того же контекста (`modules/prescriptions/voice/...`),
т.к. переиспользует те же провайдерные паттерны (Provider Pattern, деградация, приватность
медданных) и тот же вывод — позиции для корзины через `CatalogFacade`.

**Взаимодействия (расширяет матрицу `10-domain-model.md` §«Матрица взаимодействий»):**

| Откуда → Куда | Способ | Вызов |
|---|---|---|
| prescriptions → catalog | [F] | `CatalogFacade.matchByInn(rawName, rawDosage, rawForm)` — уже определено в `10-domain-model.md` строка 127, здесь используется с уточнённой сигнатурой (см. §8) |
| prescriptions → notifications | [E] | `PrescriptionNeedsClarificationEvent`, `PrescriptionRejectedEvent`, `PrescriptionVerifiedEvent` (уже определены `10-domain-model.md` строка 906-907) |
| prescriptions (voice) → catalog | [F] | `CatalogFacade.searchByText(text, limit)` — существующий поисковый путь CUJ-1, переиспользуется как есть, НЕ новый метод |
| prescriptions → moderation | [E] | **[R1] SRS-RX-001** [D-08] `PrescriptionItemControlledSubstanceExcludedEvent` — публикуется, когда кандидат исключён из матчинга по `control_category`; создаёт запись в `catalog_match_queue`-подобном компламенс-логе для последующего аудита (не блокирует пользователя, информационное событие) |
| prescriptions → orders | [F] | `PrescriptionsFacade.isVerifiedFor(customerId, medicineIds)` — уже определено (`10-domain-model.md` строка 108) |

---

## 2. Архитектура и слои (Правило Зависимостей, `02-CLEAN-ARCHITECTURE-AND-CODE.md`)

```
apps/api/src/modules/prescriptions/
├── domain/
│   ├── prescription.entity.ts            (существует, SRS-DOM-025..030 — не изменяется этим документом)
│   ├── prescription-item.entity.ts       [R1] NOVOE — value object внутри агрегата Prescription
│   ├── ocr-signals.vo.ts                 [R1] value object — 5 сигналов, все ∈ [0,1] или {0,0.5,1}
│   ├── composite-confidence-calculator.service.ts  [R1] domain service, чистая функция
│   ├── voice-intent.vo.ts                [R1] value object — разобранное намерение голосового ввода
│   ├── voice-intent-parser.service.ts    [R1] domain service, чистая функция (rule-based, БЕЗ ML)
│   └── errors/
│       ├── prescription-expired.error.ts        [R1] NOVOE
│       └── missing-raw-output-reference.error.ts (существует, SRS-DOM-029)
├── application/
│   ├── ports/
│   │   ├── prescription-ocr.port.ts       [R1] `PrescriptionOcrProvider` + `RawOcrResult` тип
│   │   ├── speech-to-text.port.ts         [R1] `SpeechToTextProvider` + `RawSttResult` тип
│   │   ├── image-preprocessing.port.ts    [R1] `ImagePreprocessingPort`
│   │   └── audio-preprocessing.port.ts    [R1] `AudioPreprocessingPort`
│   ├── use-cases/
│   │   ├── upload-prescription.use-case.ts            [R1]
│   │   ├── process-prescription-ocr-result.use-case.ts [R1] (в R1 без реального OCR — вызывается MockOcrProvider; сам use case не знает о разнице)
│   │   ├── clarify-prescription-item.use-case.ts       [R1]
│   │   ├── verify-prescription.use-case.ts             [R1]
│   │   ├── reject-prescription.use-case.ts             [R1]
│   │   ├── expire-stale-clarifications.use-case.ts     [R1] (BullMQ repeatable job)
│   │   ├── submit-voice-input.use-case.ts              [R1]
│   │   └── process-voice-input-result.use-case.ts      [R1]
│   └── policies/
│       └── prescription-access.policy.ts (существует, SRS-DOM-155 — расширяется §10.1 здесь)
├── infrastructure/
│   ├── adapters/
│   │   ├── mock-ocr.adapter.ts             [R1] `MockOcrProvider`
│   │   ├── gemini-ocr.adapter.ts           [R2] `GeminiOcrProvider`
│   │   ├── mock-stt.adapter.ts             [R1] `MockSttProvider`
│   │   ├── whisper-stt.adapter.ts          [R2] `WhisperSttProvider`
│   │   ├── sharp-image-preprocessing.adapter.ts  [R1]
│   │   └── ffmpeg-audio-preprocessing.adapter.ts [R1]
│   ├── repositories/
│   │   ├── prescription.repository.ts (существует)
│   │   └── voice-input-request.repository.ts [R1] NOVOE
│   └── queues/
│       ├── prescription-ocr.processor.ts   [R1] BullMQ, очередь `prescription_ocr_queue`
│       └── voice-input.processor.ts        [R1] BullMQ, очередь `voice_input_queue`
└── presentation/
    ├── prescriptions.controller.ts  [R1]
    └── voice-input.controller.ts    [R1]
```

**SRS-RX-002** [`02` §1.1, §1.3] `domain/composite-confidence-calculator.service.ts` и
`domain/voice-intent-parser.service.ts` НЕ импортируют `@nestjs/*`, HTTP-клиенты провайдеров, Drizzle
или `Date.now()`/`Math.random()` напрямую — принимают все входные сигналы как аргументы чистой
функции. Тест: `pnpm arch:check` не находит нарушений `dependency-cruiser` для этих файлов; unit-тест
вызывает функцию 1000 раз с одинаковым входом → 1000 идентичных выходов (детерминизм).

**SRS-RX-003** [`02` §1.3] `PrescriptionOcrProvider`, `SpeechToTextProvider`, `ImagePreprocessingPort`,
`AudioPreprocessingPort` объявлены как `interface` + Symbol DI-токен в `application/ports/*`.
Связывание — только в `prescriptions.module.ts`: `{ provide: OCR_PROVIDER, useClass: OCR_DRIVER ===
'gemini' ? GeminiOcrProvider : MockOcrProvider }`. Use case получает порт через конструктор — `new
GeminiOcrProvider()` внутри use case является блокирующим замечанием ревью.

---

## 3. Загрузка рецепта

### 3.1 Форматы и лимиты

**SRS-RX-004** [R1] [tz.log Модуль 2, REQ-OCR-2] Эндпоинт `POST /api/v1/prescriptions` принимает
`multipart/form-data` с полями:

| Поле | Тип | Обязательность | Правило |
|---|---|---|---|
| `file` | binary | обязателен | см. таблицу форматов ниже |
| `consentGiven` | `"true"` | обязателен | иначе `400 CONSENT_REQUIRED` (см. §10) |
| `notes` | string ≤ 500 символов | опционален | свободный комментарий клиента («для мамы», «повтор рецепта») |

Допустимые MIME-типы и лимиты (Zod-схема `packages/contracts/src/prescriptions.ts`,
`UploadPrescriptionFileSchema`):

| MIME | Расширение | Лимит размера | Комментарий |
|---|---|---|---|
| `image/jpeg` | .jpg/.jpeg | `PRESCRIPTION_MAX_FILE_SIZE_MB` (ASSUMPTION 10 МБ) | Основной формат — фото с камеры телефона |
| `image/png` | .png | 10 МБ | Скриншот из мессенджера |
| `image/webp` | .webp | 10 МБ | Android-камеры по умолчанию сохраняют WebP на части устройств |
| `image/heic` | .heic | 10 МБ | iPhone-камера по умолчанию; конвертируется в JPEG на этапе предобработки (§3.2) до отправки в OCR — Gemini не принимает HEIC напрямую |
| `application/pdf` | .pdf | 10 МБ, ≤ 3 страницы | Скан из регистратуры поликлиники; обрабатывается только первая страница с текстом рецепта, остальные — `imageQualityFlags.multiPageIgnored = true` |

**SRS-RX-005** [R1] Given файл превышает `PRESCRIPTION_MAX_FILE_SIZE_MB` или его MIME-тип не входит
в список выше, When `POST /api/v1/prescriptions`, Then запрос отклоняется ДО чтения файла в память
целиком (Fastify `@fastify/multipart` лимит `fileSize` в байтах) — `413 PAYLOAD_TOO_LARGE` (размер)
или `415 UNSUPPORTED_MEDIA_TYPE` (тип), без создания записи `prescriptions` (переиспользуются коды из
`12-api-conventions-auth-tenancy.md` §2.1 — новые коды не заводятся).

**SRS-RX-006** [R1] [SRS-API-009] `POST /api/v1/prescriptions` требует заголовок `Idempotency-Key`
(уже зафиксировано `12-api-conventions-auth-tenancy.md` §1.4, таблица) — повторная отправка того же
файла с тем же ключом не создаёт вторую OCR-джобу.

### 3.2 Предобработка изображения

**SRS-RX-007** [R1] [REQ-OCR-2, tz.log Модуль 2] `UploadPrescriptionUseCase` вызывает
`ImagePreprocessingPort.normalize(buffer, mimeType)` ДО постановки OCR-джобы в очередь.
Реализация — `SharpImagePreprocessingAdapter` (библиотека `sharp`, локальная, без сети), шаги
строго в этом порядке:

1. **Конвертация формата** — HEIC/WebP → JPEG (quality 92), PDF первая страница → PNG (300 DPI)
   через `pdf-to-image` внутри того же адаптера.
2. **Ориентация** — чтение EXIF `Orientation`, поворот на кратный 90° угол так, чтобы верх
   изображения соответствовал верху текста; EXIF-данные (геолокация снимка, если есть) **обязаны
   быть удалены** при пересохранении — камеры телефонов часто пишут GPS в EXIF, а фото рецепта
   содержит медданные, утечка геолокации через метаданные снимка — отдельный канал разглашения
   (REQ-REG-11).
3. **Deskew** — оценка угла наклона текста (проекционный профиль по градиенту), поворот на
   вычисленный угол в диапазоне ±15°; углы больше 15° не корректируются автоматически (риск
   искажения) — фиксируются как `imageQualityFlags.skewSevere = true`.
4. **Бинаризация** — адаптивный порог (Sauvola) для контрастного чёрно-белого варианта,
   **сохраняется ОТДЕЛЬНО** от оригинала (`processed_image_url`, оригинал остаётся
   `image_url` — Gemini получает оригинал в цвете, бинаризованная версия используется только для
   локальной оценки `imageQualityScore`, см. §5).
5. **Оценка качества** — `imageQualityScore ∈ [0,1]` (composite локальной метрики: доля
   ненулевых пикселей текста после бинаризации, дисперсия Лапласиана как индикатор резкости,
   нормированные и усреднённые) + булевы флаги `{ blurry, lowResolution (< 800px по короткой
   стороне), glare (доля переэкспонированных пикселей > 15%), cropped (текст упирается в край
   кадра) }`.

**SRS-RX-008** [R1] Given `imageQualityScore < IMAGE_QUALITY_HARD_FLOOR` (ASSUMPTION 0.15) сразу
после предобработки, When `UploadPrescriptionUseCase.execute()`, Then OCR-джоба НЕ ставится в
очередь вообще (экономия вызова платного провайдера на заведомо нечитаемом фото) —
`prescription.status` переходит напрямую `uploaded → rejected`, `rejection_reason =
'illegible_image'`, ответ API `201` с телом, где `data.status = 'rejected'` и
`data.rejectionReason` — клиент показывает «Не удалось распознать фото, сфотографируйте рецепт при
хорошем освещении и без бликов» без ожидания. Это не ошибка запроса (файл принят и сохранён для
последующей ручной проверки фармацевтом при обращении в поддержку) — HTTP `201`, не `4xx`.

### 3.3 Хранение, приватность, шифрование

**SRS-RX-009** [R1] [Charter §3.1, `ObjectStorageProvider`] Оригинал и бинаризованная версия
сохраняются через `ObjectStorageProvider` (платформенный порт, реализации `S3Provider`/MinIO —
дефолт, `LocalFsProvider` — dev без Docker) по ключу
`prescriptions/{tenant_id}/{prescription_id}/original.{ext}` и
`prescriptions/{tenant_id}/{prescription_id}/processed.png`. Бакет MinIO для рецептов —
**отдельный от публичных ассетов** (`STORAGE_BUCKET_PRESCRIPTIONS`, ASSUMPTION
`dorutj-prescriptions-private`), с политикой доступа `private` (никаких публичных presigned URL с
долгим TTL) — presigned URL, выдаваемый `GET /api/v1/prescriptions/:id/image`, живёт
`PRESCRIPTION_IMAGE_URL_TTL_SECONDS` (ASSUMPTION 300) и выпускается заново на каждый запрос.

**SRS-RX-010** [R1] [REQ-REG-11] Шифрование at rest: MinIO/S3 server-side encryption (SSE-S3 или
SSE-KMS, ключ `STORAGE_ENCRYPTION_KEY` из секретного хранилища, НЕ в `.env` в открытом виде в
продакшен-профиле) включено на бакете `STORAGE_BUCKET_PRESCRIPTIONS` обязательно; в dev-профиле
(`LocalFsProvider`) шифрование эмулируется шифрованием файла на диске AES-256-GCM с ключом из
`LOCAL_FS_ENCRYPTION_KEY`, т.к. Charter требует полной работоспособности без внешних ключей, но не
требует отказа от шифрования как принципа. Транспорт — TLS 1.2+ (Charter §5, `02` §9 baseline).

**SRS-RX-011** [R1] [Закон РТ «О здравоохранении» — врачебная/медицинская тайна; REQ-REG-10/11]
Матрица доступа к содержимому фото рецепта:

| Роль | Доступ к `image_url` | Условие | Аудит |
|---|---|---|---|
| `customer` | ✅ | только владелец (`prescriptions.customer_id = actor.id`) | нет (свой файл) |
| `pharmacist` | ✅ | назначен на заказ, ссылающийся на `prescription_id` (SRS-DOM-155б) | нет (операционный доступ) |
| `pharmacy_admin` | ❌ | — | — (видит только статус/метаданные, не бинарник — SRS-DOM-155) |
| `courier` | ❌ | — | — |
| `support_agent` | ❌ | — | — (эскалация к `super_admin` при необходимости) |
| `super_admin` | ✅ | любой | **ОБЯЗАТЕЛЬНАЯ запись `audit_log`** (SRS-DOM-155в) на КАЖДЫЙ вызов `GET /image`, не только при первом |

**SRS-RX-012** [R1] Given роль не входит в разрешённые для конкретного `prescriptionId` (таблица
выше), When `GET /api/v1/prescriptions/:id/image`, Then `403 FORBIDDEN` — политика
`PrescriptionAccessPolicy.canViewImage(actor, prescription, orderContext)` вызывается из use case
(`application`), не из guard'а (`02` §3.4), контроллер не содержит условной логики видимости.

**SRS-RX-013 — срок хранения** [R1] [ASSUMPTION до юридического заключения, Часть D п.4
`03-ARCHITECT-DECISIONS.md`] `PRESCRIPTION_IMAGE_RETENTION_DAYS` (ASSUMPTION 365) от
`prescriptions.created_at`. По истечении — scheduled BullMQ job `purge-expired-prescription-images`
(repeatable, ежедневно 04:00 `Asia/Dushanbe`) вызывает `ObjectStorageProvider.delete()` для обоих
ключей (`original`, `processed`) и проставляет `prescriptions.image_purged_at = NOW()`. **Строка
`prescriptions` НЕ удаляется** — она юридический/комплаенс-факт (кто, когда, что было подтверждено
фармацевтом), только бинарное содержимое стирается. Попытка `GET /image` после
`image_purged_at IS NOT NULL` → `404 NOT_FOUND` с `details.reason = 'image_purged_retention_expired'`.
Данное правило соответствует общему принципу схемы («юридическое хранение», `11-database-schema.md`
строка 51, где `prescriptions` уже отнесены к неудаляемым сущностям) — этот документ уточняет, что
удаляется именно бинарный контент, а не строка.

**SRS-RX-014 — обезличивание в логах** [R1] [Charter §5 «Логи», REQ-REG-11] Структурные pino-логи
НИКОГДА не содержат: содержимого `raw_name`/`raw_dosage`/`doctorNameRaw` из OCR-ответа,
транскрипта голосового ввода, presigned URL с токеном доступа к файлу. Логируется только:
`prescriptionId`, `status`, `compositeConfidence` (число), `durationMs`, `providerName`, `requestId`.
Middleware `PiiRedactionInterceptor` (presentation) применяет allow-list полей для логов эндпоинтов
`/prescriptions/*` и `/voice-input/*` — по умолчанию pino сериализует объект целиком, для этих двух
контроллеров сериализатор явно ограничен allow-list (не blacklist — вычеркнуть можно забыть новое
поле, allow-list безопаснее по умолчанию).

---

## 4. `PrescriptionOcrProvider` — порт

### 4.1 Контракт входа/выхода

**SRS-RX-015** [R1] [REQ-OCR-1] Порт `application/ports/prescription-ocr.port.ts`:

```ts
interface PrescriptionOcrProvider {
  recognize(input: OcrRecognizeInput): Promise<RawOcrResult>;
}

interface OcrRecognizeInput {
  imageBuffer: Buffer;          // оригинал после предобработки §3.2, без EXIF
  mimeType: 'image/jpeg' | 'image/png';
  requestId: string;            // сквозная трассировка, Charter §5
}
```

`RawOcrResult` — СТРОГАЯ Zod-схема (`packages/contracts/src/prescriptions.ts`,
`RawOcrResultSchema`), расширяющая структуру `tz.log` §Модуль 2 (`detected_medicines`,
`is_official_stamp_present`, `doctor_name`) полями качества изображения и явным разделением «сырой
кандидат провайдера» vs «решение бэкенда» (REQ-OCR-3, research-рекомендация #5):

```jsonc
{
  "schemaVersion": "1",
  "detectedItems": [
    {
      "rawName": "Каптоприл",              // как распознано на фото, строка 1-200 символов
      "rawDosage": "25 мг",                 // строка или null, НЕ парсится моделью в число — парсинг числа делает бэкенд
      "rawForm": "таб.",                    // строка или null (форма выпуска как написано)
      "quantityHint": "по 1 таб 2 р/д",     // свободный текст режима приёма, НЕ структурируется в R1 (см. SRS-RX-016)
      "modelSuggestedInn": "каптоприл",     // подсказка модели, СЫРАЯ, никогда не используется как решение напрямую (REQ-OCR-3)
      "vlmConfidence": 0.91                 // 0..1, сырое значение модели — ОДИН из 5 сигналов, не итог (§5)
    }
  ],
  "isOfficialStampPresent": true,           // boolean | null (null = зона печати не найдена в кадре)
  "doctorNameRaw": "Раҳимов А.А.",          // string | null
  "doctorIssuedDateRaw": "12.08.2026",      // string | null — НОВОЕ поле относительно tz.log, для проверки просрочки (§7.4)
  "imageQualityFlags": {
    "blurry": false, "lowResolution": false, "glare": false, "cropped": false, "skewSevere": false
  }
}
```

**SRS-RX-016** [R1] [REQ-OCR-3] `quantityHint` — свободный текст, сохраняется как есть в
`prescription_items.quantity_hint_raw` (см. §11) и показывается фармацевту при верификации для
прочтения глазами. Структурированный парсинг режима приёма (кратность/длительность курса) в схему
дозирования — **вне объёма R1/R2** (Won't, см. `research/00-RESEARCH-DIGEST.md` строка 218 —
телемедицинская логика и полная проверка лекарственных взаимодействий также Won't); попытка
автоматически парсить дозировку в `Dosage` VO для мед. рекомендаций без участия фармацевта была бы
клинической рекомендацией без врача — прямо избыточный риск, не требуется ни одним REQ-*.

**SRS-RX-017** [R1] [REQ-OCR-3, SRS-DOM-026] `RawOcrResult` НЕ содержит поля `compositeConfidence`
или любого другого поля «финального решения» — тип на уровне TypeScript физически не позволяет
адаптеру вернуть такое поле (compile-time защита дублирует доменное правило SRS-DOM-026).

### 4.2 Таймауты, ретраи, деградация

**SRS-RX-018** [R1] [Charter §7 «Отказоустойчивость»] `GeminiOcrProvider`/`MockOcrProvider`
вызываются ТОЛЬКО из BullMQ-обработчика `prescription-ocr.processor.ts` (очередь
`prescription_ocr_queue`), никогда синхронно из HTTP-запроса — загрузка (`POST /prescriptions`)
возвращает `202`-подобный `201` немедленно со статусом `uploaded`/`ocr_processing`, результат
приходит клиенту через WS-событие `prescription.status_changed` (реалтайм-канал, `12-api-
conventions-auth-tenancy.md` §6) или поллингом `GET /api/v1/prescriptions/:id`.

| ENV | Дефолт (ASSUMPTION) | Назначение |
|---|---|---|
| `OCR_DRIVER` | `mock` | `mock` \| `gemini` |
| `OCR_TIMEOUT_MS` | `15000` | Таймаут одного вызова провайдера |
| `OCR_MAX_RETRIES` | `2` | Повторы при таймауте/5xx/сетевой ошибке |
| `OCR_RETRY_BACKOFF_BASE_MS` | `1000` | Экспоненциальный backoff: `base * 2^attempt` + джиттер ±20% |
| `OCR_CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `5` | Подряд неуспехов на инстанс до перехода в `OPEN` |
| `OCR_CIRCUIT_BREAKER_COOLDOWN_MS` | `60000` | Время в `OPEN` до пробного `HALF_OPEN` запроса |

**SRS-RX-019** [R1] Given BullMQ-джоба `prescription_ocr_queue` вызывает провайдер и получает
таймаут/сетевую ошибку, When попыток исчерпано меньше `OCR_MAX_RETRIES`, Then джоба ретраится с
backoff (встроенный механизм BullMQ, Charter §3.1 таблица провайдеров), `prescription.status`
остаётся `ocr_processing` (клиент видит «обрабатывается», не ошибку на каждый внутренний ретрай).

**SRS-RX-020** [R1] [SRS-DOM-174] Given ретраи исчерпаны ИЛИ `CircuitBreaker` в состоянии `OPEN`
(порог `OCR_CIRCUIT_BREAKER_FAILURE_THRESHOLD` превышен), When джоба обрабатывает рецепт, Then
`prescription.status → rejected`, `rejection_reason = 'ocr_provider_unavailable'`, публикуется
`PrescriptionRejectedEvent` → `notifications` уведомляет клиента: «Автораспознавание временно
недоступно. Загрузите рецепт позже или обратитесь в аптеку лично для оформления Rx-позиций» —
формулировка обязана явно называть alternative (личное обращение), не оставлять пользователя в
тупике. Circuit breaker состояние — per-инстанс в памяти процесса worker (не Redis-shared) —
приемлемо, т.к. деградация одного worker-инстанса не блокирует остальные экземпляры в проде
(масштабирование по горизонтали компенсирует), а per-инстанс breaker не требует дополнительной
инфраструктуры.

**SRS-RX-021** [R1] [Charter §7] Недоступность `PrescriptionOcrProvider` НЕ блокирует остальной
чекаут: заказы без Rx-позиций оформляются нормально (`OrderPolicy` не зависит от состояния OCR
конвейера) — деградация локализована в границах модуля `prescriptions`, никакая другая часть
системы не проверяет доступность OCR синхронно.

### 4.3 `GeminiOcrProvider` [R2]

**SRS-RX-022** [R2] [tz.log Модуль 2] Модель `gemini-2.5-flash` (`GEMINI_MODEL` ENV, дефолт
зафиксирован явной строкой, не «последняя доступная» — Baseline §принцип выбора версий), вызов через
Structured Output (`responseSchema` = JSON-Schema, сгенерированная из `RawOcrResultSchema`)
— провайдер гарантированно возвращает валидный JSON без дополнительного парсинга текста ответа.
`GEMINI_API_KEY` — секрет, отсутствие при `OCR_DRIVER=gemini` — фатальная ошибка старта приложения
(`fail fast`, не ошибка на первом запросе).

**SRS-RX-023** [R2] Изображение передаётся в Gemini как inline base64 (лимит Gemini API на размер
inline-данных — 10 МБ, что совпадает с `PRESCRIPTION_MAX_FILE_SIZE_MB`, разрыва нет намеренно).

### 4.4 `MockOcrProvider` [R1]

**SRS-RX-024** [R1] [Charter §3.3 «Provider Pattern... честная реализация контракта», Charter DoD
п.6] `MockOcrProvider` — детерминированный, БЕЗ случайности и сети:

1. Вычисляет `sha256(imageBuffer)`.
2. Если хеш совпадает с одной из зарегистрированных **E2E-фикстур**
   (`tests/e2e/fixtures/prescriptions/*.jpg` + соответствующий `*.expected-ocr.json` в том же
   каталоге — контракт «имя файла без расширения = ключ фикстуры»), возвращает СОХРАНЁННЫЙ
   `RawOcrResult` из `*.expected-ocr.json` — стабильный результат для Playwright E2E (CUJ-5), не
   зависящий от порядка запуска или окружения.
3. Если хеш НЕ совпадает ни с одной фикстурой (реальное фото пользователя в dev/staging без
   Gemini-ключа), генерирует детерминированный результат ПО СОД�ержИМОМУ хеша (не по времени/
   `Math.random()`): байты хеша используются как seed для `PRNG` (`seedrandom`-подобный, чистая
   функция), формирующего 1-3 `detectedItems` со случайными, но воспроизводимыми (при повторном
   вызове с ТЕМ ЖЕ файлом — тот же результат) `rawName` из фиксированного pool-словаря 20
   распространённых МНН каталога (`captopril`, `paracetamol`, `citramon`, ...), `vlmConfidence`
   в диапазоне, зависящем от `imageQualityScore` предобработки (выше качество кадра → выше
   сгенерированная уверенность, чтобы деградированные тестовые фото давали правдоподобно низкий
   confidence) — это НЕ случайное поведение с точки зрения теста: тот же файл всегда даёт тот же
   результат.

**SRS-RX-025 — тест на детерминизм** [R1] Given один и тот же файл рецепта, When
`MockOcrProvider.recognize()` вызывается дважды (в разных процессах/на разных машинах CI), Then оба
вызова возвращают побайтово идентичный JSON. Проверяется unit-тестом
`mock-ocr.adapter.spec.ts`.

---

## 5. `composite_confidence` — детерминированная формула (D-14)

**SRS-RX-026** [R1] [D-14, REQ-OCR-3, REQ-OCR-4] `composite_confidence` вычисляется ИСКЛЮЧИТЕЛЬНО
доменным сервисом `CompositeConfidenceCalculator.calculate(signals: OcrSignals):
CompositeConfidence` — чистая функция, принимающая 5 независимых сигналов (≥4 по требованию D-14,
сделано 5 для устойчивости к отсутствию одного сигнала). **Прямое присвоение `composite_confidence
= vlmConfidence` — запрещено на уровне типов** (SRS-DOM-026 уже фиксирует это правило; здесь —
точная формула, которой в `10-domain-model.md` не было).

### 5.1 Пять сигналов (на уровне ОДНОЙ позиции рецепта / одного кандидата-медикамента)

| # | Сигнал | Обозначение | Диапазон | Источник | Как вычисляется |
|---|---|---|---|---|---|
| 1 | Уверенность модели | `S_model` | `[0, 1]` | `RawOcrResult.detectedItems[i].vlmConfidence` | Клэмп в `[0,1]`, округление не требуется (сырое значение провайдера) |
| 2 | Качество матчинга с каталогом | `S_catalog_match` | `[0, 1]` | `similarity(rawName, candidate.tradeName)` через `pg_trgm` (та же функция, что и SRS-DB-018) | Триграммное сходство ТОП-кандидата из `CatalogFacade.matchByInn()`, уже нормировано `pg_trgm` в `[0,1]` |
| 3 | Согласованность дозировки/формы | `S_dosage_form` | `{0, 0.5, 1}` | `rawDosage`/`rawForm` vs `candidate.dosageStrength`/`candidate.dosageForm` | `1` — распарсенное значение (число + единица) точно совпадает с данными кандидата в каталоге; `0.5` — распарсено, но единицы требуют конвертации/не совпадают точно (напр. `250 мг` заявлено, у кандидата `0.25 г`, тот же порядок, конвертация возможна) либо форма не указана в OCR; `0` — `rawDosage` не парсится в число+единицу вообще, либо парсится, но противоречит кандидату (напр. `500 мг` заявлено, у кандидата `10 мг`) |
| 4 | Присутствие в каталоге | `S_catalog_presence` | `{0, 1}` | Результат `CatalogFacade.matchByInn()` | `1` — найден хотя бы один кандидат с `similarity ≥ 0.35` (порог SRS-DB-018, переиспользуется для консистентности с 1С-матчингом) среди `is_published=true` и `control_category NOT IN ('psychotropic','narcotic')`; `0` — ни одного кандидата не прошло порог (после исключения контролируемых веществ, см. SRS-RX-001) |
| 5 | Наличие печати/подписи | `S_stamp` | `{0, 0.5, 1}` | `RawOcrResult.isOfficialStampPresent` | `1` — `true`; `0` — явно `false` (модель нашла область, где должна быть печать, и её там нет — сильный сигнал подделки/незавершённого рецепта); `0.5` — `null` (зона печати не в кадре/не определена — нейтрально, не наказывается за плохой кадрирование, но и не поощряется) |

### 5.2 Веса и формула

**SRS-RX-027** [R1] [REQ-OCR-4 «пороговая логика конфигурируется»] Веса — ENV-константы,
сумма **обязана** равняться `1.000` (проверяется тестом на старте приложения — `fail fast`, если
сумма отличается больше чем на `0.001` из-за округления):

| ENV | Дефолт | Вес |
|---|---|---|
| `CONFIDENCE_WEIGHT_MODEL` | `0.35` | `w1` |
| `CONFIDENCE_WEIGHT_CATALOG_MATCH` | `0.25` | `w2` |
| `CONFIDENCE_WEIGHT_DOSAGE_FORM` | `0.20` | `w3` |
| `CONFIDENCE_WEIGHT_CATALOG_PRESENCE` | `0.15` | `w4` |
| `CONFIDENCE_WEIGHT_STAMP` | `0.05` | `w5` |

```
itemConfidence(candidate) = round3(
    w1 * S_model
  + w2 * S_catalog_match
  + w3 * S_dosage_form
  + w4 * S_catalog_presence
  + w5 * S_stamp
)
```

`round3` — округление до 3 знаков (`NUMERIC(4,3)`, соответствует колонке `composite_confidence`),
режим round-half-up, детерминированный (`Math.round(x * 1000) / 1000`, без плавающей нестабильности
— вычисление ведётся в целых тысячных через `BigInt`-арифметику весов ×1000, не через `float`
сложение — Charter §5 «Деньги: … float-вычисления денег = дефект» распространяется по аналогии на
любые проверяемые числовые решения домена, не только деньги).

**SRS-RX-028 — на уровне позиции с несколькими кандидатами** [R1] [SRS-DOM-028, REQ-OCR-6] Для
каждой `detectedItems[i]` `CatalogFacade.matchByInn()` возвращает до 5 кандидатов (`LIMIT 5`, как
в SRS-DB-018), отсортированных по `similarity` убыв. `itemConfidence()` вычисляется для КАЖДОГО
кандидата отдельно (т.к. `S_dosage_form` зависит от конкретного кандидата). Финальное решение по
позиции:

```
sorted = candidates.sortByDesc(itemConfidence)
top1 = sorted[0]; top2 = sorted[1]

if sorted.isEmpty():
    itemStatus = 'needs_clarification'; itemComposite = 0  # S_catalog_presence=0 для всех, будет 0 и без этой ветки, ветка — для читаемости
elif top2 exists AND (top1.confidence - top2.confidence) < LASA_AMBIGUITY_MARGIN:
    itemStatus = 'needs_clarification'   # форсировано, НЕЗАВИСИМО от значения top1.confidence (SRS-DOM-028)
    itemComposite = top1.confidence       # сохраняется для отображения, но статус не 'auto_matched'
    lasaCandidateCount = count(c in sorted where top1.confidence - c.confidence < LASA_AMBIGUITY_MARGIN)
else:
    itemComposite = top1.confidence
    itemStatus = decisionFromThreshold(itemComposite)  # §5.3
```

`LASA_AMBIGUITY_MARGIN` — ENV, дефолт `0.10` (ASSUMPTION, ранее зафиксирован в `10-domain-model.md`
как `LASA_AMBIGUITY_MARGIN`, здесь — то же имя переменной, не переопределяется).

### 5.3 Пороги решения (агрегация позиция → рецепт)

**SRS-RX-029** [R1] [D-14] `decisionFromThreshold(x)`:

| Диапазон `itemComposite` | Статус позиции | Что происходит |
|---|---|---|
| `x ≥ 0.85` | `matched_high_confidence` | Кандидат предзаполняется как «предложенный товар», НО не добавляется в корзину автоматически без просмотра клиентом (см. §7) |
| `0.50 ≤ x < 0.85` | `needs_clarification` | Клиенту показывается вопрос-уточнение (§8.3) |
| `x < 0.50` | `rejected` | Позиция отклонена, `rejection_reason` зависит от причины (`S_catalog_presence=0` → `medicine_not_in_catalog`; иначе → `low_confidence_match`) |

**SRS-RX-030** [R1] [D-14, SRS-DOM-113/114/115] Статус **рецепта в целом** (`prescriptions.status`,
поле `composite_confidence`) — агрегация по ВСЕМ позициям (принцип «худшая позиция определяет
исход», уже подразумевается формулировкой `10-domain-model.md` строки 757-759 «≥2 близких LASA-
кандидата НА ОДНУ позицию» — это правило теперь формализовано explicit-агрегацией):

```
prescriptions.composite_confidence = MIN(item.itemComposite for item in items)

if ANY item.status == 'needs_clarification':
    prescriptions.status = 'needs_clarification'
elif ANY item.status == 'rejected' AND NO item.status IN ('matched_high_confidence', 'needs_clarification'):
    prescriptions.status = 'rejected'
elif ALL items.status == 'matched_high_confidence':
    prescriptions.status = 'auto_matched'
else:
    # смесь matched_high_confidence + rejected (напр. 2 из 3 позиций уверенно распознаны,
    # 1 — не найдена в каталоге вовсе) — трактуется как needs_clarification, т.к. рецепт
    # содержит нерешённую позицию, требующую участия клиента/фармацевта
    prescriptions.status = 'needs_clarification'
```

Это ЕДИНСТВЕННОЕ место, где `MIN()` применяется как правило агрегации — выбрано намеренно
консервативно (одна нераспознанная/сомнительная позиция не должна «маскироваться» уверенными
соседними позициями), соответствует духу D-14 «рецептурная позиция ВСЕГДА требует подтверждения
человеком».

**SRS-RX-031 — тест формулы** [R1] Unit-тест `composite-confidence-calculator.spec.ts` — таблица из
≥12 комбинаций сигналов с ожидаемым `itemConfidence` (включая крайние `S=[1,1,1,1,1] → 1.000`,
`S=[0,0,0,0,0] → 0.000`, и минимум одну комбинацию на каждую границу порога `0.85`/`0.50`).

---

## 6. Верификация фармацевтом

**SRS-RX-032** [R1] [D-14, REQ-OCR-5, REQ-REG-2, CUJ-5] Rx-позиция **ВСЕГДА** требует явного
подтверждения `pharmacist` независимо от `composite_confidence` — `auto_matched` (значение статуса
из `prescriptions.status`, отличное от статуса позиции `matched_high_confidence`, см. state machine
`10-domain-model.md` §3) НЕ является финальным разрешением на Rx-checkout; только
`prescriptions.status = 'verified'` разблокирует `orders:create` (SRS-DOM-004, уже определено).

### 6.1 Что видит фармацевт

**SRS-RX-033** [R1] Экран верификации (`apps/web` кабинет аптеки, R1-9 из Pivot; тот же API
используется будущим Flutter-терминалом R2-1 без изменений — Charter §3.6 API-first) показывает по
`GET /api/v1/prescriptions/:id`:

1. Оригинал фото (через `GET /api/v1/prescriptions/:id/image`, лениво по клику «Показать оригинал»
   — не загружается автоматически списком, чтобы не тратить presigned URL TTL впустую).
2. Список `prescription_items` (§11) с: `rawName`, `rawDosage`, `rawForm`, `quantityHint`,
   `itemComposite`, топ-3 кандидата (`medicineId`, `tradeName`, `similarityScore`) и статус.
3. `doctorNameRaw`, `doctorIssuedDateRaw` (если распознано), `isOfficialStampPresent`.
4. Поле ручного ввода `doctorIssuedDate` (дата, редактируемая фармацевтом — OCR-дата ЧАСТО
   нечитаема, фармацевт вводит по факту просмотра оригинала) — обязательно перед `verify()`, если
   хотя бы одна позиция в рецепте относится к категории, для которой включена проверка срока
   действия (`RX_EXPIRY_CHECK_ENABLED_CATEGORIES`, ASSUMPTION `['prescription_only', 'potent']`
   — `psychotropic`/`narcotic` не доходят до этого экрана вовсе, см. §9).
5. Кнопки: **«Подтвердить»** (`verify`), **«Отклонить»** (`reject`, с обязательным выбором причины
   из списка §6.3), **«Запросить у клиента уточнение»** (переводит конкретную позицию обратно в
   `needs_clarification`, даже если она уже была `matched_high_confidence`, — фармацевт может не
   согласиться с автораспознаванием).

### 6.2 Эндпоинты

| Метод и путь | Роль | Тело | Ответ |
|---|---|---|---|
| `GET /api/v1/prescriptions/:id` | `customer` (владелец) / `pharmacist` (назначен) / `super_admin` | — | `data: PrescriptionDto` (без `imageUrl`, SRS-DOM-030) |
| `GET /api/v1/prescriptions/:id/items` | те же | — | `data: PrescriptionItemDto[]` с кандидатами |
| `GET /api/v1/prescriptions/:id/image` | см. §3.3 | — | `data: { presignedUrl, expiresAt }` |
| `POST /api/v1/prescriptions/:id/verify` | `pharmacist` | `{ doctorIssuedDate?: string }` | `data: PrescriptionDto` статус `verified` |
| `POST /api/v1/prescriptions/:id/reject` | `pharmacist` | `{ reason: RejectionReasonEnum, comment?: string }` | `data: PrescriptionDto` статус `rejected` |
| `POST /api/v1/prescriptions/:id/items/:itemId/clarify` | `customer` | `{ selectedMedicineId: uuid }` \| `{ notInList: true }` | `data: PrescriptionItemDto` |

### 6.3 Причины отказа (`rejection_reason`, канонический словарь приложения)

**SRS-RX-034** [R1] `rejection_reason` — `VARCHAR(100)` в схеме (уже существует, не меняется),
значения — enum на уровне `packages/contracts` (`PrescriptionRejectionReason`), НЕ база данных
(гибкость добавления причины без миграции):

| Значение | Кто ставит | Смысл |
|---|---|---|
| `illegible_image` | система (SRS-RX-008) или `pharmacist` | Фото нечитаемо |
| `not_a_prescription` | `pharmacist` | Загружено не изображение рецепта (чек, случайное фото, скриншот переписки) |
| `medicine_not_in_catalog` | система | Ни одна позиция не сопоставлена с каталогом (§5.3) |
| `low_confidence_match` | система | `itemComposite < 0.50`, но `S_catalog_presence = 1` (кандидат есть, но общая уверенность низкая) |
| `missing_stamp_or_signature` | `pharmacist` | Печать/подпись врача отсутствует или явно поддельная |
| `suspected_forgery` | `pharmacist` | Подозрение на подделку (несовпадение почерка/явные артефакты редактирования) |
| `expired` | `pharmacist` или система (§9) | Истёк срок действия рецепта |
| `controlled_substance_forbidden` | система (D-08, немедленно) | Обнаружен psychotropic/narcotic — жёсткий отказ |
| `ocr_provider_unavailable` | система (SRS-RX-020) | Провайдер недоступен после ретраев |
| `clarification_timeout` | система | Клиент не ответил на уточнение в `CLARIFICATION_WINDOW_HOURS` (уже SRS-DOM-117) |
| `customer_cancelled` | `customer` | Клиент сам отменил загрузку (действие вне scope верификации, для полноты словаря) |

**SRS-RX-035** [R1] Given `pharmacist.reject(reason)`, When `reason` не входит в
`PrescriptionRejectionReason`, Then `400 VALIDATION_ERROR` (Zod-валидация тела запроса на уровне
DTO, до вызова use case) — свободный текст допускается ТОЛЬКО в дополнительном поле `comment`
(≤ 500 символов), не в самом `reason`.

---

## 7. Сопоставление распознанного с каталогом

**SRS-RX-036** [R1] [D-06, D-07] Нормализация `rawName` перед матчингом (домен, чистая функция
`normalizeDrugName(raw: string): string`, используется идентично для OCR и голосового ввода — ЕДИНАЯ
точка нормализации, не дублируется):

1. `trim()`, схлопывание множественных пробелов.
2. Приведение к нижнему регистру с учётом таджикской кириллицы (`ӣ ӯ ҳ қ ғ ҷ` сохраняются как есть —
   `toLowerCase()` JS корректно обрабатывает эти кодовые точки, отдельной таблицы транслитерации не
   требуется на этом шаге, в отличие от полнотекстового поиска каталога, где транслит уже
   реализован конфигурацией `tajik_ru` — переиспользуется `SRS-DB` словарь конфигурации FTS, не
   создаётся заново).
3. Удаление типографских артефактов OCR: одиночные завершающие точки/запятые, повторяющиеся дефисы.
4. Разделение «название + единица измерения, слитно распознанные» (`каптоприл25мг` →
   `каптоприл 25мг`) через regex-разделитель между буквенным и числовым сегментом — частая ошибка
   OCR на рукописных рецептах.

**SRS-RX-037** [R1] [D-06] Сопоставление выполняется ЧЕРЕЗ `CatalogFacade.matchByInn(rawName,
rawDosage?, rawForm?)` (существующий фасадный метод, `10-domain-model.md` строка 127) — внутри
использует ТОТ ЖЕ SQL-запрос композитного триграммного матчинга, что и 1С-импорт (SRS-DB-018,
порог `similarity ≥ 0.35`), с добавлением фильтра `control_category NOT IN ('psychotropic',
'narcotic')` (переиспользует индекс `ix_medicines_control_category`, SRS-DOM-157) — этот фильтр
применяется В ЗАПРОСЕ, а не постфильтрацией в коде, чтобы контролируемые вещества никогда не
попадали даже в «топ-5 кандидатов» списка, показываемого клиенту.

**SRS-RX-038 — разрешение неоднозначности через уточняющий вопрос** [R1] [REQ-OCR-6] Given позиция
в статусе `needs_clarification` (из-за LASA или диапазона `0.50-0.85`), When клиент открывает экран
уточнения, Then показываются ДО 5 кандидатов с `tradeName`, `dosageForm`, `dosageStrength`,
референсной ценой (минимальная цена по видимым аптекам, переиспользует существующий поисковый
запрос) и явной кнопкой «Ни один из этих» (`notInList: true`). Клиент выбирает ОДИН вариант —
`ClarifyPrescriptionItemUseCase` пересчитывает `itemComposite` для выбранного кандидата с
`S_model` и `S_dosage_form`, зафиксированными как для исходного топ-кандидата (сигналы OCR не
меняются от выбора человека), но статус позиции становится `matched_high_confidence` НЕЗАВИСИМО
от числового значения — выбор человека имеет приоритет над формулой на этом шаге (человек уже
подтвердил соответствие) — при этом `prescriptions.status` пересчитывается заново по правилу §5.3
(другие позиции рецепта могли остаться `needs_clarification`).

**SRS-RX-039** [R1] Given клиент выбрал «Ни один из этих» (`notInList: true`), When
`ClarifyPrescriptionItemUseCase`, Then позиция → `rejected`, `rejection_reason =
'medicine_not_in_catalog'`, и клиенту предлагается путь **вне AI-конвейера**: обратиться к
фармацевту при получении заказа/лично, либо (если остальные позиции рецепта распознаны) продолжить
только с распознанными позициями — рецепт в целом остаётся `needs_clarification` до решения
фармацевта на этапе верификации (фармацевт видит все позиции, включая отклонённые клиентом, и может
вручную указать соответствие при верификации через отдельное поле `pharmacistOverrideMedicineId`,
если физически видит рецепт и узнаёт препарат, который OCR/каталог не нашли).

---

## 8. Голосовой ввод (D-15)

### 8.1 `SpeechToTextProvider` — порт

**SRS-RX-040** [R1] [D-15, REQ-STT-1] `application/ports/speech-to-text.port.ts`:

```ts
interface SpeechToTextProvider {
  transcribe(input: SttTranscribeInput): Promise<RawSttResult>;
}

interface SttTranscribeInput {
  audioBuffer: Buffer;         // после ресемплинга §8.3, 16kHz mono PCM/WAV
  language: 'tg' | 'ru';       // ЯВНО передаётся, БЕЗ auto-detect (REQ-STT-1) — выбирается пользователем в UI ДО записи (тумблер языка, дефолт = текущая локаль интерфейса)
  initialPrompt: string;       // ≤ ~200 токенов, см. §8.4
  requestId: string;
}

interface RawSttResult {
  transcript: string;
  languageUsed: 'tg' | 'ru';   // эхо входного параметра, для аудита несовпадения не бывает (не auto-detect)
  durationSec: number;
}
```

### 8.2 `WhisperSttProvider` [R2] / `MockSttProvider` [R1]

**SRS-RX-041** [R2] [D-15] Базовая модель Whisper (`STT_MODEL`, ASSUMPTION `whisper-1`, БЕЗ
дообучения на тадж. диалектах — research прямо опровергает существование такой модели, см.
`research/00-RESEARCH-DIGEST.md` строка 537-541 и Часть B D-15 `03-ARCHITECT-DECISIONS.md`).
**Явный риск, фиксируемый как принятое ограничение MVP, не дефект**: WER (word error rate) для
таджикского не бенчмаркан ни одним публичным источником на момент разработки — голос
спроектирован как ВТОРИЧНЫЙ канал ввода (первичный — поиск текстом, CUJ-1), деградация качества
распознавания таджикской речи не блокирует ни один критический путь.

**SRS-RX-042** [R1] `MockSttProvider` — детерминированный, аналогично `MockOcrProvider` (SRS-RX-024):
`sha256(audioBuffer)` → фикстура `tests/e2e/fixtures/voice/*.ogg` +
`*.expected-transcript.json`, либо seed-based генерация транскрипта из pool фраз на `tg`/`ru`
(«ба ман каптоприл лозим аст», «нужен парацетамол и аспирин кардио») для файлов вне фикстур.

### 8.3 Формат аудио и лимиты

**SRS-RX-043** [R1] Эндпоинт `POST /api/v1/voice-input`, `multipart/form-data`:

| Поле | Правило |
|---|---|
| `file` | `audio/ogg` (Opus, Telegram voice по умолчанию), `audio/webm` (браузерный `MediaRecorder`), `audio/mpeg`, `audio/wav`, `audio/m4a` |
| `language` | `"tg"` \| `"ru"`, обязателен (REQ-STT-1 — сервер отклоняет запрос без явного языка, `400 VALIDATION_ERROR`) |

| Параметр | ENV | Дефолт (ASSUMPTION) |
|---|---|---|
| Макс. размер файла | `VOICE_INPUT_MAX_SIZE_MB` | `10` |
| Макс. длительность | `VOICE_INPUT_MAX_DURATION_SEC` | `60` |
| Мин. длительность | `VOICE_INPUT_MIN_DURATION_SEC` | `1` (короче — вероятный случайный тап, `422 BUSINESS_RULE_VIOLATION`, `details.reason='audio_too_short'`) |

**SRS-RX-044** [R1] `AudioPreprocessingPort.normalize(buffer, mimeType)` (адаптер `ffmpeg`, локально,
без сети) — ресемплинг к 16kHz mono PCM WAV (формат, ожидаемый Whisper API), измерение фактической
длительности (источник правды для лимита длительности — не полагаемся на клиентские метаданные,
которые легко подделать/ошибиться) — если фактическая длительность после декодирования превышает
`VOICE_INPUT_MAX_DURATION_SEC`, аудио **обрезается** до лимита с явным флагом
`RawSttResult`-metadata `truncated: true` (не отклоняется целиком — часть запроса лучше, чем ничего)
и клиенту показывается предупреждение «Запись обрезана до 60 секунд».

### 8.4 Промпт-глоссарий и code-switching

**SRS-RX-045** [R1] [REQ-STT-3, tz.log Модуль 2 пример «Салом алейкум, ба ман барои фишори баланд
каптоприл ва аспирин кардио лозим»] `initialPrompt` формируется динамически
`BuildSttPromptUseCase` (application, вызывается ПЕРЕД `transcribe()`): берёт до 30 самых частых
(по `search_query_log`/аналитике, если данных ещё нет — курированный статический список топ-30
МНН из seed-каталога) торговых названий и МНН на обоих алфавитах (`tradeName`, `innName`),
конкатенирует через запятую, обрезает до ~200 токенов (эвристика: 1 токен ≈ 4 символа для
кириллицы, `Math.floor(200 * 4)` символов максимум, обрезка по границе слова). Промпt НЕ содержит
весь каталог (REQ-STT-3 явно запрещает) — это bias-подсказка модели по терминологии, не источник
истины.

**SRS-RX-046 — code-switching тадж/рус** [R1] [Контекст research: смешанная речь — норма в РТ]
Whisper не переключает язык внутри одного вызова — `language` передаётся один раз на весь клип
(выбор пользователя в UI ДО записи). Практическая мера для смешанной речи (тадж. предложение +
русские/интернациональные фармацевтические термины типа «каптоприл», «аспирин») —
ИМЕННО промпт-глоссарий (SRS-RX-045): термины-заимствования в подсказке узнаются моделью как ожидаемые
токены независимо от выбранного основного языка распознавания. Полноценное авто-переключение языка
в середине фразы — вне возможностей базового Whisper API, явно НЕ обещается пользователю
(формулировка UI: «Выберите язык, на котором будете говорить» — не «мы понимаем оба языка сразу»).

### 8.5 Разбор в намерение и позиции

**SRS-RX-047** [R1] [REQ-STT-2] `VoiceIntentParser.parse(transcript: string): VoiceIntent` —
доменный сервис, чистая функция, **rule-based, БЕЗ ML** (детерминированность обязательна для тестов):

1. Нормализация транскрипта (та же `normalizeDrugName`-логика на уровне предложения: нижний
   регистр, схлопывание пробелов).
2. Поиск глагольных маркеров намерения по словарю (`packages/i18n` — список ключевых слов НЕ
   хардкодится в домене, инжектируется как конфигурация `IntentKeywordsConfig`, локализуемая):
   `ru: ["нужен","нужны","нужна","купить","ищу","добавь","закажи"]`,
   `tg: ["лозим","харидан","меёбам","илова кун"]`. Наличие ≥1 маркера →
   `intentType = 'search_and_suggest'`; отсутствие → `intentType = 'search_only'` (различие влияет
   только на текст UI-приглашения «Добавить найденное в корзину?» vs «Вот что нашлось», НЕ на то,
   добавляется ли что-то автоматически — см. SRS-RX-048).
3. Извлечение сегментов-кандидатов на название препарата: скользящее окно по N-граммам слов (1-3
   слова), каждый сегмent передаётся в `CatalogFacade.searchByText()` (существующий поисковый путь
   CUJ-1, `SRS-DB` §«Поиск по каталогу» — переиспользуется КАК ЕСТЬ, без нового SQL); сегменты с
   `similarity < 0.35` отбрасываются, оставшиеся дедуплицируются по `medicineId`, сортируются по
   score, `LIMIT 5`.

**SRS-RX-048 — запрет авто-добавления** [R1] [REQ-STT-2, жёсткое требование] Given
`VoiceIntentParser` вернул кандидатов с ЛЮБЫМ значением similarity (включая `1.0`, точное
совпадение), When результат показывается клиенту, Then НИ ОДНА позиция не добавляется в корзину
автоматически — UI показывает список найденного, клиент нажимает «В корзину» для каждой позиции
индивидуально (тот же компонент, что и обычный поиск CUJ-1, переиспользуется). Голосовой ввод —
**альтернативный способ ЗАПОЛНИТЬ ПОИСКОВУЮ ВЫДАЧУ**, не короткий путь в обход обычного флоу
добавления в корзину. Rx-товары, найденные голосом, проходят ТОТ ЖЕ гейт `PrescriptionNotVerifiedError`
при попытке оформления, что и любой другой источник (SRS-DOM-004) — голосовой ввод НЕ создаёт и не
подтверждает рецепт.

**SRS-RX-049** [R1] Эндпоинты голосового ввода:

| Метод и путь | Роль | Тело/ответ |
|---|---|---|
| `POST /api/v1/voice-input` | `customer` | multipart аудио → `202`-подобно `201`, `data: { voiceInputId, status: 'processing' }` |
| `GET /api/v1/voice-input/:id` | `customer` (владелец) | `data: { status, transcript?, intentType?, candidates?: MedicineSearchResultDto[] }` — `transcript` возвращается ТОЛЬКО владельцу, не в списковых/админских представлениях (симметрично приватности фото рецепта, §10) |

---

## 9. Наркотические/психотропные вещества в рецепте (D-08 — жёсткий отказ)

**SRS-RX-050** [R1] [D-08, критично] Given результат матчинга (OCR или голос) для позиции содержит
кандидата, у которого `medicines.control_category IN ('psychotropic', 'narcotic')`, When
`CatalogFacade.matchByInn()`/`searchByText()` формирует список кандидатов, Then такой кандидат
**НИКОГДА не появляется в списке** — фильтр `WHERE control_category NOT IN (...)` применяется в
самом SQL-запросе (переиспользует `ix_medicines_control_category`, SRS-DOM-157), не постфильтрацией
после получения результатов в коде приложения (защита от программной ошибки, при которой
отфильтрованный элемент случайно "просочился" бы через промежуточный кэш/сериализацию).

**SRS-RX-051** [R1] [D-08] Given ПОСЛЕ исключения контролируемых кандидатов позиция OCR осталась
БЕЗ ни одного кандидата (`S_catalog_presence = 0`), И при этом `modelSuggestedInn` (сырая подсказка
модели, НЕ авторитетная) текстуально похож на известное наименование из справочника контролируемых
веществ (`control_category != 'none'` — простая проверка `similarity(modelSuggestedInn, m.trade_name)
≥ 0.35` ПО ВСЕЙ таблице `medicines`, включая исключённые категории, ТОЛЬКО для этой диагностической
проверки, не для показа пользователю), When `ProcessPrescriptionOcrResultUseCase`, Then публикуется
`PrescriptionItemControlledSubstanceExcludedEvent` (SRS-RX-001) — асинхронное информационное событие
для `moderation`/compliance-роли, позиция получает `rejection_reason =
'controlled_substance_forbidden'`, клиенту показывается нейтральный текст: «Указанная позиция не
может быть заказана дистанционно. Обратитесь в аптеку лично» — БЕЗ подтверждения или отрицания
того, что именно распознано (не давать пользователю сигнал о категории вещества текстом ответа —
достаточно факта отказа), рецепт в целом → `needs_clarification` минимум (не `verified` никогда
для этой позиции; фармацевт при верификации видит эту позицию как исключённую и не может её
включить в состав Rx-checkout независимо от собственного решения — это ИНВАРИАНТ на уровне домена,
не полномочие роли).

**SRS-RX-052** [R1] Эта же проверка применяется к голосовому вводу: кандидаты `control_category IN
('psychotropic','narcotic')` исключены из `searchByText()` результатов идентично обычному поиску
(SRS-DOM-157 уже покрывает публичный поиск целиком — голосовой ввод переиспользует тот же путь,
доп. правило не требуется).

---

## 10. Приватность и комплаенс — сводная матрица

**SRS-RX-053** [R1] [REQ-REG-9, REQ-REG-10, REQ-REG-11, врачебная тайна] Итоговая матрица доступа
(объединяет SRS-DOM-155 + SRS-RX-011/012, единая таблица для разработчика):

| Данные | customer (владелец) | pharmacist (назначен на заказ) | pharmacy_admin | courier | support_agent | super_admin |
|---|---|---|---|---|---|---|
| `prescriptions.status`, метаданные (без фото) | ✅ | ✅ | ✅ (только своя сеть) | ❌ | ⚠ по открытому тикету | ✅ |
| Фото рецепта (`image_url`) | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ + `audit_log` |
| `raw_model_output_ref` (сырой JSON OCR) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ + `audit_log` (для расследования ошибок распознавания) |
| Транскрипт голосового ввода | ✅ (свой) | ❌ | ❌ | ❌ | ❌ | ✅ + `audit_log` |
| `doctorNameRaw`, `doctorIssuedDateRaw` | ✅ (свой) | ✅ (назначен) | ❌ | ❌ | ❌ | ✅ |

**SRS-RX-054 — audit_log** [R1] [REQ-REG-10, таблица `audit_log` уже определена
`11-database-schema.md` строка 1268] Каждый доступ `super_admin` к `image_url`,
`raw_model_output_ref` или транскрипту голоса пишет строку `audit_log(entity_type='prescription' |
'voice_input_request', entity_id, actor_user_id, action='view_prescription_image' |
'view_prescription_raw_output' | 'view_voice_transcript', created_at)` — запись создаётся В ТОЙ ЖЕ
транзакции, что и выдача presigned URL (`unitOfWork.run()`), а не «best effort» после ответа — если
запись audit_log не удалась, presigned URL не выдаётся (`500 INTERNAL_ERROR`, отказ безопаснее
утечки без следа).

**SRS-RX-055 — согласие (consent)** [R1] [REQ-REG-9] Текст согласия (i18n-ключ
`prescriptions.consent.text`, tj/ru/en — Charter §5 «i18n: ВСЕ пользовательские строки») обязан
явно называть: (а) фото/аудио передаётся **внешнему AI-провайдеру за пределами Таджикистана**
(Gemini/Google, Whisper/OpenAI — трансграничная передача, риск отмечен в
`research/00-RESEARCH-DIGEST.md` строка 590); (б) срок хранения (§3.3/§10.3); (в) кто может
просматривать (таблица выше, упрощённо для пользователя). Чекбокс согласия — НЕ предзаполнен
(`checked` по умолчанию `false`), отдельный от общего согласия на обработку персональных данных при
регистрации (SRS-DOM-025 уже требует `consentGiven=true` на уровне домена — этот пункт уточняет
UX-требование к формулировке, не меняет инвариант).

**SRS-RX-056 — срок хранения и удаление** [R1] См. SRS-RX-013 (фото). Для голосового ввода:
`voice_input_requests.audio_purged_at` — аналогичная джоба `purge-expired-voice-audio`,
`VOICE_INPUT_AUDIO_RETENTION_DAYS` (ASSUMPTION 30 — короче, чем фото рецепта: аудио не несёт
самостоятельной юридической ценности как рецепт, это лишь способ ввода поискового запроса, retention
короче по умолчанию privacy-by-design). Транскрипт (текст) хранится дольше аудио
(`VOICE_INPUT_TRANSCRIPT_RETENTION_DAYS`, ASSUMPTION 90, для анализа качества/метрик R1-15), но
БЕЗ привязки к аудиофайлу после его удаления — колонка `transcript_text` не зависит от
`audio_purged_at`.

---

## 11. Дополнения к схеме БД

> Обоснование каждого дополнения — почему поля не хватает в `11-database-schema.md` — приведено
> перед DDL. Именование и стиль (UUID PK, `tenant_id NOT NULL`, `created_at TIMESTAMPTZ`) —
> идентичны остальной схеме.

### 11.1 `prescriptions.doctor_issued_date` — НОВАЯ колонка

**Обоснование**: существующая схема (`11-database-schema.md` строка 1025-1048) не содержит даты
выписки рецепта, необходимой для проверки просрочки (§9, edge case «просроченный рецепт» из
задания этого документа). OCR извлекает `doctorIssuedDateRaw` как ненадёжную строку — финальное
значение подтверждается фармацевтом.

```sql
ALTER TABLE prescriptions
    ADD COLUMN doctor_issued_date_raw VARCHAR(50),   -- сырая строка из OCR, НЕ парсится в домене напрямую
    ADD COLUMN doctor_issued_date DATE,               -- подтверждено/введено фармацевтом при verify()
    ADD COLUMN image_purged_at TIMESTAMPTZ;            -- SRS-RX-013, отметка удаления бинарного контента после retention

COMMENT ON COLUMN prescriptions.doctor_issued_date IS
    'SRS-RX-033/034: вводится фармацевтом на экране верификации, обязательно для категорий из '
    'RX_EXPIRY_CHECK_ENABLED_CATEGORIES. NULL допустим для рецептов без применимой проверки срока.';
```

**SRS-RX-057 — инвариант просрочки** [R1] `Prescription.verify(pharmacistId, doctorIssuedDate?)`
бросает `PrescriptionExpiredError` (НОВЫЙ домен-класс, `422 PRESCRIPTION_EXPIRED`, новый код в
`packages/contracts/src/errors.ts`), если ХОТЯ БЫ одна позиция рецепта относится к категории из
`RX_EXPIRY_CHECK_ENABLED_CATEGORIES` И `doctorIssuedDate + RX_VALIDITY_DAYS < today()` (`Clock`
port, домен не читает системное время напрямую — Charter/`02` §2.6). `RX_VALIDITY_DAYS` — ENV,
ASSUMPTION `30` (единое значение для MVP; дифференциация по типу заболевания/хронического рецепта —
вне объёма R1, требует медицинского регламента, не найденного в research). Given `doctorIssuedDate`
не передан И категория требует проверки, Then `verify()` бросает `MissingDoctorIssuedDateError`
(НОВЫЙ, `400 VALIDATION_ERROR`, `details.field='doctorIssuedDate'`) — фармацевт обязан явно
подтвердить дату ИЛИ явно отклонить рецепт, «пропустить» шаг невозможно.

### 11.2 `prescription_items` — НОВАЯ таблица

**Обоснование**: `prescriptions` (существующая схема) хранит `composite_confidence`,
`lasa_candidate_count` и связанные сигналы КАК ЕДИНСТВЕННЫЕ колонки на весь рецепт, но и
`10-domain-model.md` (SRS-DOM-028, строки 757-758), и `tz.log` (`detected_medicines: array`)
однозначно описывают рецепт как список из НЕСКОЛЬКИХ позиций, каждая — с собственным кандидатом,
confidence и LASA-статусом. Без отдельной таблицы невозможно корректно реализовать §5
(`itemConfidence` на уровне позиции) и §8.3 UI-экран верификации (список позиций). Существующая
колонка `prescriptions.composite_confidence` **переопределяется семантически** (без слома типа) как
производное значение `MIN(prescription_items.item_composite_confidence)` — вычисляется и
записывается `CompositeConfidenceCalculator` в той же транзакции, что и запись строк
`prescription_items` (SRS-RX-030).

```sql
CREATE TYPE prescription_item_status AS ENUM (
    'pending_ocr', 'matched_high_confidence', 'needs_clarification', 'confirmed', 'rejected'
);

CREATE TABLE prescription_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    line_number SMALLINT NOT NULL,                    -- порядок позиции на рецепте, для стабильного UI-списка
    raw_name VARCHAR(200) NOT NULL,
    raw_dosage VARCHAR(100),
    raw_form VARCHAR(100),
    quantity_hint_raw VARCHAR(300),                    -- SRS-RX-016, свободный текст режима приёма
    model_suggested_inn VARCHAR(200),                  -- сырая подсказка VLM, НЕ авторитетная (REQ-OCR-3)
    vlm_confidence NUMERIC(4,3),                       -- сигнал 1
    top_candidates JSONB NOT NULL DEFAULT '[]',        -- [{medicineId, tradeName, similarityScore, itemConfidence}], до 5 записей
    matched_medicine_id UUID REFERENCES medicines(id) ON DELETE SET NULL,  -- выбранный кандидат (авто либо clarify)
    item_composite_confidence NUMERIC(4,3),            -- результат itemConfidence() §5.2
    lasa_candidate_count SMALLINT NOT NULL DEFAULT 0,  -- сколько кандидатов попали в margin (SRS-RX-028)
    status prescription_item_status NOT NULL DEFAULT 'pending_ocr',
    rejection_reason VARCHAR(100),                     -- из словаря §6.3
    clarified_by_customer_at TIMESTAMPTZ,
    pharmacist_override_medicine_id UUID REFERENCES medicines(id) ON DELETE SET NULL, -- SRS-RX-039
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_prescription_items_line UNIQUE (prescription_id, line_number)
);

COMMENT ON TABLE prescription_items IS
    'SRS-RX-057..: гранулярность "одна позиция рецепта" — расширение D-14/REQ-OCR поверх '
    'header-таблицы prescriptions (11-database-schema.md стр. 1023-1065), которая хранит только '
    'агрегированные значения. prescriptions.composite_confidence = MIN(item_composite_confidence).';

CREATE INDEX ix_prescription_items_prescription ON prescription_items (prescription_id, line_number);
CREATE INDEX ix_prescription_items_status ON prescription_items (status) WHERE status = 'needs_clarification';
```

**SRS-RX-058** [R1] `ALTER TABLE prescriptions` — добавление проверочного ограничения, что
`composite_confidence` пересчитывается только доменным сервисом, не устанавливается напрямую SQL
(это дисциплина на уровне `application`/репозитория — Drizzle-репозиторий `PrescriptionRepository`
экспонирует метод `saveWithItems(prescription, items)`, обновляющий обе таблицы атомарно, НЕ
позволяет частичного апдейта одного `composite_confidence` без пересчитанных `items`).

### 11.3 `voice_input_requests` — НОВАЯ таблица

**Обоснование**: в существующей схеме голосовой ввод не описан вовсе (0 упоминаний `voice`/`stt` в
`11-database-schema.md`). Нужна для: (а) статуса/поллинга (§8.5 `GET /voice-input/:id`); (б) метрик
воронки R1-15 (Pivot §3.1 — «доля показов… добавление в корзину» для голосового канала отдельно);
(в) audit/retention для транскрипта (§10.3).

```sql
CREATE TYPE voice_input_status AS ENUM ('processing', 'completed', 'failed', 'expired_no_match');

CREATE TABLE voice_input_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    audio_object_key TEXT,                             -- MinIO ключ, NULL после purge
    audio_purged_at TIMESTAMPTZ,
    language VARCHAR(2) NOT NULL,                      -- 'tg' | 'ru', явно переданное (REQ-STT-1)
    duration_sec NUMERIC(5,2) NOT NULL,
    truncated BOOLEAN NOT NULL DEFAULT false,          -- SRS-RX-044
    transcript_text TEXT,
    intent_type VARCHAR(30),                           -- 'search_and_suggest' | 'search_only'
    matched_candidates JSONB NOT NULL DEFAULT '[]',    -- [{medicineId, tradeName, similarityScore}], до 5
    status voice_input_status NOT NULL DEFAULT 'processing',
    failure_reason VARCHAR(100),                        -- 'stt_provider_unavailable' | 'audio_too_short' | ...
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE voice_input_requests IS
    'D-15/REQ-STT/CUJ-8. Эфемерные данные голосового поиска — НЕ создают заказ напрямую (REQ-STT-2), '
    'только предзаполняют поисковую выдачу. Retention короче prescriptions (SRS-RX-056).';

CREATE INDEX ix_voice_input_requests_customer ON voice_input_requests (customer_id, created_at DESC);
```

### 11.4 Новые коды ошибок (`packages/contracts/src/errors.ts`)

| Code | HTTP | Класс домена | Когда |
|---|---|---|---|
| `PRESCRIPTION_EXPIRED` | 422 | `PrescriptionExpiredError` | SRS-RX-057 |
| `MISSING_DOCTOR_ISSUED_DATE` | 400 | `MissingDoctorIssuedDateError` | SRS-RX-057 |
| `AUDIO_TOO_SHORT` | 422 | `BusinessRuleViolationError` (переиспользуется базовый класс, не заводится новый) | SRS-RX-043 |
| `VOICE_LANGUAGE_REQUIRED` | 400 | `ValidationError` (переиспользуется) | SRS-RX-043 |

Остальные исходы (`CONSENT_REQUIRED`, `PRESCRIPTION_NOT_VERIFIED`, `OCR_PROVIDER_UNAVAILABLE`,
`CONTROLLED_SUBSTANCE_FORBIDDEN`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `NOT_FOUND`, `RATE_
LIMITED`) переиспользуют коды, уже определённые в `10-domain-model.md` §«Доменные ошибки» и
`12-api-conventions-auth-tenancy.md` §2.1 — новые не заводятся.

### 11.5 Rate limiting — новые записи в таблицу `12-api-conventions-auth-tenancy.md` §1.6

| Область | Лимит (ASSUMPTION) | Ключ |
|---|---|---|
| `POST /api/v1/prescriptions` | `RATE_LIMIT_PRESCRIPTION_UPLOAD_PER_DAY = 20` | `userId` |
| `POST /api/v1/voice-input` | `RATE_LIMIT_VOICE_INPUT_PER_HOUR = 10` | `userId` |

Превышение → `429 RATE_LIMITED` (существующий код, не новый).

---

## Пограничные случаи и ошибки

| # | Ситуация | Обнаружение | Поведение системы | Ссылка |
|---|---|---|---|---|
| 1 | Нечитаемое фото (размыто/засвечено/обрезано) | `imageQualityScore < 0.15` после предобработки | OCR-джоба не запускается, `status='rejected'`, `reason='illegible_image'`, `201` немедленно | SRS-RX-008 |
| 2 | Загружено не изображение рецепта (чек, селфи, скриншот переписки) | Фармацевт при верификации (модель может дать низкий `S_catalog_presence`, но не гарантированно) | `pharmacist.reject('not_a_prescription')` | §6.3 |
| 3 | Позиция рецепта — препарат не из каталога вообще | `S_catalog_presence=0` после матчинга с порогом 0.35 | Позиция `rejected`, `reason='medicine_not_in_catalog'`; клиент может выбрать «Ни один из этих» на этапе уточнения если позиция была `needs_clarification` из-за LASA | SRS-RX-029, SRS-RX-039 |
| 4 | Просроченный рецепт | `doctorIssuedDate + RX_VALIDITY_DAYS < today()` на шаге `verify()` | `PrescriptionExpiredError` → `422 PRESCRIPTION_EXPIRED`, верификация заблокирована, фармацевт должен `reject('expired')` | SRS-RX-057 |
| 5 | Наркотическое/психотропное вещество в рецепте | Кандидат исключён фильтром `control_category` до появления в списке | Позиция `rejected('controlled_substance_forbidden')` немедленно, независимо от confidence; НЕ подлежит override фармацевтом (домен-инвариант) | SRS-RX-050, D-08 |
| 6 | Провайдер OCR недоступен (таймаут/5xx) — единичный сбой | `OCR_MAX_RETRIES` не исчерпан | Ретрай с backoff, статус остаётся `ocr_processing`, пользователь не уведомляется о промежуточных попытках | SRS-RX-019 |
| 7 | Провайдер OCR недоступен — устойчиво (circuit breaker `OPEN`) | `OCR_CIRCUIT_BREAKER_FAILURE_THRESHOLD` превышен | `status='rejected'`, `reason='ocr_provider_unavailable'`, уведомление с альтернативой (обратиться в аптеку лично); остальной чекаут не блокируется | SRS-RX-020, SRS-RX-021 |
| 8 | Гонка: клиент отправляет `clarify` дважды на одну позицию (двойной тап) | `PrescriptionItem` уже не в статусе `needs_clarification` (изменился между запросами) | Второй запрос → `409 INVALID_STATE_TRANSITION` (переиспользует `ForbiddenTransitionError`, не создаётся новый код) | SRS-RX-038, `SRS-DOM` таксономия |
| 9 | Дубль загрузки одного и того же фото (повторный тап на «Отправить») | `Idempotency-Key` совпадает | Возвращается сохранённый ответ первой попытки, вторая OCR-джоба не создаётся | SRS-RX-006, SRS-API-010 |
| 10 | Клиент не отвечает на уточнение | `clarification_requested_at + CLARIFICATION_WINDOW_HOURS (24ч)` истёк | `status→rejected`, `reason='clarification_timeout'` (уже существующий переход SRS-DOM-117) | — |
| 11 | Превышен дневной лимит загрузок рецептов | `RATE_LIMIT_PRESCRIPTION_UPLOAD_PER_DAY` | `429 RATE_LIMITED` с `X-RateLimit-*` заголовками | SRS-RX §11.5 |
| 12 | Аудио короче 1 секунды (случайный тап на микрофон) | `durationSec < VOICE_INPUT_MIN_DURATION_SEC` после декодирования | `422 BUSINESS_RULE_VIOLATION`, `details.reason='audio_too_short'` | SRS-RX-043 |
| 13 | Голосовой ввод не даёт ни одного совпадения (бессвязная речь/шум) | 0 кандидатов после `searchByText` по всем сегментам | `voice_input_requests.status='expired_no_match'`, UI: «Ничего не найдено, попробуйте текстовый поиск» | §8.5 |
| 14 | Отсутствует сеть у клиента в момент отправки фото | Клиентская сторона (вне бэкенда) | Fastify не получает запрос — не создаётся `prescriptions`-строка вообще; клиент обязан ретраить с тем же `Idempotency-Key`, сгенерированным ДО первой попытки (клиентское требование, не серверное) | — |
| 15 | Rx-заказ пытаются оформить, пока рецепт ещё `ocr_processing`/`needs_clarification` | Проверка в `orders`-модуле при checkout | `PrescriptionNotVerifiedError` → `422 PRESCRIPTION_NOT_VERIFIED` (уже существует) | SRS-DOM-004 |
| 16 | `pharmacist.verify()` вызван для рецепта, где НЕ ВСЕ позиции `matched_high_confidence`/`confirmed` (часть ещё `needs_clarification`/`rejected`) | Проверка инварианта в `verify()` | Домен разрешает верификацию рецепта ЦЕЛИКОМ только по позициям, дошедшим до решения; позиции `rejected` просто исключаются из итогового Rx-набора (не блокируют verify остальных), позиции `needs_clarification` БЛОКИРУЮТ verify до решения клиента/фармацевта (`InvalidPrescriptionTransitionError`) | Уточнение SRS-DOM-118 |
| 17 | Файл в разрешённом MIME, но повреждён (битый JPEG) | `sharp` бросает исключение при декодировании на этапе предобработки | `400 VALIDATION_ERROR`, `details.reason='corrupt_image_file'`, файл не сохраняется в object storage | SRS-RX-007 |
| 18 | HEIC-файл от iPhone без установленного конвертера в окружении (редкое отсутствие codec) | Исключение конвертации в `SharpImagePreprocessingAdapter` | Тот же путь, что «повреждён» — `400 VALIDATION_ERROR`, `details.reason='unsupported_heic_variant'`, сообщение просит переснять в JPEG (настройка камеры) | SRS-RX-004 |
| 19 | `super_admin` запрашивает фото, но запись в `audit_log` не удалась (сбой БД в момент записи) | Транзакция `unitOfWork.run()` | Presigned URL НЕ выдаётся, `500 INTERNAL_ERROR` — отказ безопаснее выдачи без следа | SRS-RX-054 |
| 20 | Ретеншн истёк, но заказ, ссылающийся на рецепт, всё ещё в открытом споре (`order_disputes`) | `purge-expired-prescription-images` job проверяет связанные активные споры перед удалением | Job пропускает удаление бинарника для рецептов с `orders.id IN (SELECT order_id FROM order_disputes WHERE status NOT IN (терминальные))`, откладывает до следующего запуска после закрытия спора | SRS-RX-013 (уточнение) |

---

## Тестовые сценарии

| # | ID | Дано | Действие | Ожидаемый результат |
|---|---|---|---|---|
| 1 | TC-RX-001 | Валидный JPEG 2 МБ, `consentGiven=true` | `POST /api/v1/prescriptions` | `201`, `data.status='uploaded'`, запись в очереди `prescription_ocr_queue` создана (проверка через инспекцию Redis/BullMQ в интеграционном тесте) |
| 2 | TC-RX-002 | `consentGiven` отсутствует в теле | `POST /api/v1/prescriptions` | `400 CONSENT_REQUIRED`, строка `prescriptions` НЕ создана |
| 3 | TC-RX-003 | Файл 15 МБ (> лимита 10 МБ) | `POST /api/v1/prescriptions` | `413 PAYLOAD_TOO_LARGE`, файл не читается целиком в память (проверка через мок `@fastify/multipart` с ограничением) |
| 4 | TC-RX-004 | Файл `image/gif` | `POST /api/v1/prescriptions` | `415 UNSUPPORTED_MEDIA_TYPE` |
| 5 | TC-RX-005 | Фикстура `blurry-prescription.jpg`, `imageQualityScore=0.08` | `POST /api/v1/prescriptions` | `201`, `data.status='rejected'`, `data.rejectionReason='illegible_image'`, OCR-джоба НЕ поставлена (0 сообщений в очереди) |
| 6 | TC-RX-006 | Фикстура `clean-3-items.jpg` с 3 позициями, все `similarity ≥ 0.9`, дозировки совпадают, штамп есть | `MockOcrProvider.recognize()` → `ProcessPrescriptionOcrResultUseCase` | Все 3 `prescription_items.status='matched_high_confidence'`, `prescriptions.status='auto_matched'`, `composite_confidence = MIN(3 значений) ≥ 0.85` |
| 7 | TC-RX-007 | Позиция с двумя кандидатами: `itemConfidence` `0.91` и `0.87` (разница `0.04 < LASA_AMBIGUITY_MARGIN=0.10`) | `CompositeConfidenceCalculator` + агрегация | Позиция → `needs_clarification` НЕЗАВИСИМО от `0.91 ≥ 0.85`; `lasa_candidate_count=2` |
| 8 | TC-RX-008 | Рецепт с 2 позициями: одна `matched_high_confidence` (0.90), другая `rejected` (`medicine_not_in_catalog`) | Агрегация статуса рецепта | `prescriptions.status='needs_clarification'` (смешанный случай, §5.3 правило) |
| 9 | TC-RX-009 | Кандидат с `control_category='narcotic'` теоретически похож на `rawName` по trigram | `CatalogFacade.matchByInn()` вызван при обработке OCR-результата | Кандидат ОТСУТСТВУЕТ в возвращённом списке (SQL-фильтр), позиция получает `rejection_reason='controlled_substance_forbidden'` |
| 10 | TC-RX-010 | Рецепт `status='needs_clarification'`, `pharmacist.verify()` вызван | `POST /:id/verify` | `409 INVALID_STATE_TRANSITION` — verify недоступен, пока есть неразрешённые позиции |
| 11 | TC-RX-011 | Рецепт со всеми позициями `matched_high_confidence`/`confirmed`, `pharmacist` вызывает `verify` без `doctorIssuedDate`, категория позиции требует проверки срока | `POST /:id/verify` body `{}` | `400 MISSING_DOCTOR_ISSUED_DATE` |
| 12 | TC-RX-012 | То же, `doctorIssuedDate` = 40 дней назад, `RX_VALIDITY_DAYS=30` | `POST /:id/verify` body `{ doctorIssuedDate }` | `422 PRESCRIPTION_EXPIRED` |
| 13 | TC-RX-013 | То же, `doctorIssuedDate` = 5 дней назад | `POST /:id/verify` | `200`, `prescriptions.status='verified'`, `verified_by=pharmacistId`, событие `PrescriptionVerifiedEvent` опубликовано (проверка через `outbox`) |
| 14 | TC-RX-014 | Rx-заказ с `prescriptionId`, статус рецепта `auto_matched` (НЕ `verified`) | `POST /api/v1/orders` | `422 PRESCRIPTION_NOT_VERIFIED` — высокий `composite_confidence` НЕ заменяет верификацию человеком (ключевой тест D-14) |
| 15 | TC-RX-015 | `customer` вызывает `clarify` с `selectedMedicineId`, не входящим в `top_candidates` этой позиции | `POST /:id/items/:itemId/clarify` | `400 VALIDATION_ERROR` (выбор ограничен предложенным списком, свободный `medicineId` не принимается вне списка — защита от подмены) |
| 16 | TC-RX-016 | Тот же `Idempotency-Key`, тот же файл, повторная отправка `POST /api/v1/prescriptions` | Повтор запроса | Возвращается сохранённый `201`-ответ первой попытки, НЕ создаётся вторая запись `prescriptions` (проверка `COUNT(*) = 1`) |
| 17 | TC-RX-017 | `OCR_DRIVER=gemini` (тестовый режим с мок-HTTP-сервером, эмулирующим таймаут), `OCR_MAX_RETRIES=2` | Джоба `prescription_ocr_queue` обрабатывается | Ровно 3 вызова провайдера (1 исходный + 2 ретрая) с растущим backoff, после — `status='rejected'`, `reason='ocr_provider_unavailable'` |
| 18 | TC-RX-018 | 5 последовательных сбоев провайдера подряд (порог `OCR_CIRCUIT_BREAKER_FAILURE_THRESHOLD=5`) | 6-й запрос к провайдеру | Breaker в `OPEN`, 6-й вызов НЕ доходит до сетевого HTTP (мок фиксирует 0 дополнительных вызовов), немедленный `rejected` |
| 19 | TC-RX-019 | `super_admin` вызывает `GET /:id/image` дважды подряд | Два запроса | Две отдельные строки в `audit_log` (не одна, не пропущена вторая) |
| 20 | TC-RX-020 | `pharmacy_admin` (не назначенный на заказ) вызывает `GET /:id/image` | `GET /:id/image` | `403 FORBIDDEN` |
| 21 | TC-RX-021 | `prescriptions.created_at` старше `PRESCRIPTION_IMAGE_RETENTION_DAYS`, связанных активных споров нет | Запуск `purge-expired-prescription-images` job | `image_purged_at` заполнено, объекты удалены из MinIO (проверка вызова `ObjectStorageProvider.delete` дважды — original + processed), строка `prescriptions` НЕ удалена |
| 22 | TC-RX-022 | Тот же случай, но у заказа открыт активный `order_dispute` | Запуск той же job | Удаление ПРОПУЩЕНО для этой записи, `image_purged_at` остаётся `NULL` |
| 23 | TC-RX-023 | Аудиофайл `.ogg`, `language='tg'`, 45 сек | `POST /api/v1/voice-input` → `MockSttProvider` | `202`-подобный `201`, затем (поллинг/WS) `status='completed'`, `transcript` непустой, `candidates` содержит ≥1 позицию для фикстуры с известным МНН |
| 24 | TC-RX-024 | Аудио 90 сек (> лимита 60), реальная длительность после декодирования 90 | `POST /api/v1/voice-input` | Обработка использует первые 60 сек, `voice_input_requests.truncated=true`, ответ содержит предупреждение |
| 25 | TC-RX-025 | Аудио без поля `language` в форме | `POST /api/v1/voice-input` | `400 VALIDATION_ERROR`, `details.field='language'` — НЕ auto-detect (REQ-STT-1) |
| 26 | TC-RX-026 | Транскрипт «нужен парацетамол» (глагольный маркер есть, МНН находится) | `VoiceIntentParser.parse()` | `intentType='search_and_suggest'`, `candidates` содержит `paracetamol`-товары; НИ ОДНА позиция не в корзине клиента до явного клика (проверка состояния корзины БД — 0 строк `cart_items` создано) |
| 27 | TC-RX-027 | Транскрипт — бессвязный шум/непонятная речь, 0 сегментов проходят порог 0.35 | `VoiceIntentParser.parse()` + матчинг | `voice_input_requests.status='expired_no_match'`, `candidates=[]` |
| 28 | TC-RX-028 | `MockOcrProvider`/`MockSttProvider`, один и тот же входной файл, 100 повторных вызовов | Юнит-тест на детерминизм | Все 100 результатов побайтово идентичны (`JSON.stringify` равенство) |
| 29 | TC-RX-029 | Сумма весов `CONFIDENCE_WEIGHT_*` в `.env.test` намеренно испорчена (`0.90` вместо `1.00`) | Старт приложения (`onModuleInit` проверка) | Приложение НЕ стартует, ошибка конфигурации в логе с точным указанием суммы и ожидаемого значения (`fail fast`) |
| 30 | TC-RX-030 | E2E (Playwright) полный CUJ-5: загрузка фикстуры → авто-матч → `needs_clarification` по одной позиции → клиент уточняет → фармацевт `verify` → `POST /orders` с `prescriptionId` | Полный сценарий от логина до заказа | Заказ создан успешно (`201`), содержит Rx-позицию, `order_items` ссылается на верифицированный `prescriptionId` |
| 31 | TC-RX-031 | E2E CUJ-8: голосовая фикстура на `ru` → распознавание → добавление найденного вручную в корзину → checkout | Полный сценарий | Корзина содержит выбранную клиентом (не автоматически) позицию, заказ создаётся штатно |
| 32 | TC-RX-032 | Смена `BRAND_NAME` в конфиге (Charter/D-01/Pivot §8) | Полный прогон текстов согласия/уведомлений модуля prescriptions/voice-input | Ни один i18n-ключ модуля (`prescriptions.consent.text` и др.) не содержит захардкоженной строки бренда — весь брендинг только через `brand.name`/`--brand-*` |

---

**Конец документа.**
