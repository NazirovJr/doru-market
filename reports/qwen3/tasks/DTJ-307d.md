# ЗАДАНИЕ DTJ-307d — SLA сборки: консьюмер очереди `picking-sla-watchdog` в `apps/worker`

> Прочитай этот файл целиком одним вызовом `read`. Инструмент сам печатает в конце вывода
> `(End of file - total N lines)` — эта пометка и значит, что файл прочитан весь;
> последняя строка файла — `=== КОНЕЦ ЗАДАНИЯ DTJ-307d ===`. Пометки нет — дочитай
> остаток через `read` с `offset` и только потом работай.
> Если история сжата или ты не помнишь следующий шаг — перечитай этот файл: `reports/qwen3/tasks/DTJ-307d.md`.

> Координатору перед отправкой: DTJ-307a..c влиты в `development`, ветка этого задания создана от него.
> Для гейта `-Full` должны быть подняты Postgres и Redis из docker compose — в полном наборе `apps/worker`
> есть интеграционные спеки.

## 0. Карточка задачи

Цель: `apps/worker` слушает очередь `picking-sla-watchdog`, которую наполняет `apps/api` при
`accept`. Мягкий джоб (`soft`) вызывает `POST /api/v1/internal/orders/:id/picking-sla-breach`.
Жёсткий джоб (`hard`) вызывает уже существующий `requestSystemOrderCancel` с
`expectedFromStatus: 'processing'` и `reason: 'pickup_sla_timeout'`. Статус заказа воркер сам не
проверяет — это делает `apps/api`: если сборка успела завершиться, он ответит `skipped`.
Рабочая папка — та, что открыта в этой сессии dsh (общий репозиторий, в нём работают и другие).
Меняешь ровно эти файлы (все пути внутри `apps/worker/src/`):

СОЗДАТЬ:
- `jobs/escrow-timeouts/picking-sla-watchdog.types.ts` — имена джобов и форма данных
- `jobs/escrow-timeouts/picking-sla-watchdog.job.ts` — обработчик
- `jobs/escrow-timeouts/picking-sla-watchdog.job.spec.ts` — его тесты
- `jobs/escrow-timeouts/picking-sla-watchdog.module.ts` — Worker и Nest-модуль
- `jobs/escrow-timeouts/picking-sla-watchdog.module.spec.ts` — DI-тест модуля

ИЗМЕНИТЬ:
- `queues/queue.constants.ts` — имя очереди `PICKING_SLA_WATCHDOG`
- `jobs/escrow-timeouts/system-order-cancel.client.ts` — `'processing'` в `SystemCancelExpectedStatus`
- `app.module.ts` — подключить `PickingSlaWatchdogModule`

Любой другой файл не трогай. Понадобилось — это СТОП (раздел 7).
Не делаешь: ничего в `apps/api`, новый HTTP-клиент для system-cancel (он уже есть), изменения в
существующей джобе `PickupSlaTimeoutJob`.

Первое действие — `todo_write`: первый пункт — цель задания одной фразой своими словами, дальше шаги раздела 4.
Второе — `git status --short`: пусто — работай, есть чужие изменения — это СТОП (раздел 7).
Третье — своя ветка от `development`: `git checkout -b feat/dtj-307d-sla-watchdog-worker development`.
Сразу после неё — `git branch --show-current`: в выводе должна быть эта ветка.

## 1. Среда — как пользоваться инструментами

**Главное правило dsh:** не пиши текст перед вызовом инструмента — сразу вызывай инструмент.
Сообщение без вызова инструмента dsh считает концом работы. Текст пишешь один раз — в отчёте из раздела 8.

1. `pwsh` — это Windows PowerShell 5.1. В нём НЕТ: `&&`, `||`, `grep`, `find -name`, `cat`, `sed`,
   `rm -rf`, `del /s /q`. Несколько команд подряд — через `;`.
2. Каждый вызов `pwsh` — новый процесс, `cd` не сохраняется. Нужна другая папка — параметр `workdir`.
3. Искать текст — инструмент `grep`, всегда с `path` (`apps/...` или `packages/...`). Искать файл —
   `glob`. Читать — `read`: файлы длиннее 200 строк — частями через `offset`/`limit`. Менять — `edit`.
   Не читай файл целиком, если нужный кусок уже приведён в задании: чем больше прочитано, тем
   медленнее ты пишешь (20 тыс. токенов истории — 25 слов в секунду, 45 тыс. — уже 12).
4. Всё под `.claude/`, `dist/`, `coverage/`, `node_modules/` — старые копии и сборки. Не читать и не править.
5. В импортах пишется `.js` (`'./x.job.js'`), а на диске лежит `x.job.ts`. Открывай `.ts`.
6. `edit`: перед каждой правкой перечитай этот кусок файла. `old_string` копируй из вывода `read`
   дословно, без номеров строк. `new_string` обязан отличаться от `old_string`. `replace_all` не используй.
   Один вызов не должен нести больше ~100 строк кода. Пока ты пишешь аргумент, dsh не видит ни
   одного символа и через 20 минут молчания рвёт вызов. Длинный файл создавай в два-три приёма:
   `write` с шапкой и первым тестом, дальше `edit` — по одному тесту.
7. Проверка — только эта команда (в `workdir` = рабочая папка). Свои способы проверки не
   придумывай, кэши не чисти:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1 -Allowed 'apps/worker/src/jobs/escrow-timeouts/picking-sla-watchdog.*','apps/worker/src/queues/queue.constants.ts','apps/worker/src/jobs/escrow-timeouts/system-order-cancel.client.ts','apps/worker/src/app.module.ts'`
   В вызове `pwsh` обязательно укажи `timeoutMs: 600000`: полный гейт идёт до 4 минут, а без этого
   dsh обрывает команду через 2.
   Последняя строка вывода — `GATE: PASS` или `GATE: FAIL -> <что упало>`. Над ней — ошибки с `файл(строка)`.
8. git: можно `git status`, `git diff` и создать свою ветку
   (команды — в разделах 0 и 8). Нельзя: `merge`, `rebase`, `push`, `reset`, `stash`, переключаться
   на чужие ветки. Сам `git commit` не запускай: в песочнице dsh он обрывается на хуках husky.
   Коммит делает гейт с `-Commit` (раздел 8), слияние в `development` — координатор.
   git в песочнице dsh иногда печатает `couldn't create signal pipe, Win32 error 5` и отдаёт
   `exit code: 1`, хотя команда выполнена. Это сбой песочницы, а не git: смотри на результат, а
   не на код возврата — после ветки `git branch --show-current`, после коммита `git log --oneline -1`.

## 2. Проверенные факты (development @ `cd49440` + DTJ-307a..c, проверено координатором)

### 2.1 Уже есть — используй как есть, заново не создавай
- `requestSystemOrderCancel(deps, { orderId, tenantId, expectedFromStatus, reason })` и тип
  `SystemOrderCancelDeps` (`{ apiInternalUrl: string; internalApiKey: string | undefined }`) —
  `apps/worker/src/jobs/escrow-timeouts/system-order-cancel.client.ts`. Бьёт в
  `POST /api/v1/internal/orders/:id/system-cancel`, при не-2xx бросает, при успехе возвращает
  `{ orderId, status: 'cancelled' | 'skipped', refundIssued }`. `reason: 'pickup_sla_timeout'` уже поддержан.
- На стороне `apps/api` (DTJ-307a) system-cancel уже принимает `'processing'`, а
  `SystemCancelOrderUseCase` для `processing` делает полный рефанд (не наличные) и освобождает резерв.
  Отмену и рефанд воркер НЕ реализует.
- На стороне `apps/api` (DTJ-307a) есть `POST /api/v1/internal/orders/:id/picking-sla-breach`,
  тело `{ tenantId }`, заголовок `x-internal-api-key`. Ответ 200 и при `published`, и при `skipped`.
- Имя очереди и джобов задано продюсером в `apps/api` (DTJ-307c): очередь `'picking-sla-watchdog'`,
  джобы `'soft'` и `'hard'`, данные `{ orderId, tenantId }`. Строки должны совпадать буквально.
- Образец модуля с Worker — `jobs/escrow-timeouts/partial-fulfillment-timeout.module.ts`. Образец
  обработчика с `fetch` — `jobs/escrow-timeouts/partial-fulfillment-timeout.job.ts`. Тексты ниже уже
  адаптированы, копируй их.

### 2.2 Этого НЕТ — не выдумывай, не ищи
- `apps/worker` не может импортировать код `apps/api` (`@/modules/...` из api) — это отдельный
  TS-проект. Константы копируются, а не импортируются.
- Класс `PickupSlaTimeoutJob` уже существует — это ДРУГАЯ джоба (DTJ-254, cron-сканер непринятых
  заказов). Её файлы не трогай, новый класс называется `PickingSlaWatchdogJob`.
- Второй пары токенов конфигурации нет и не нужно: `API_INTERNAL_URL` и `INTERNAL_API_KEY` читаются
  из `ConfigService`, как в образце модуля.

### 2.3 Ловушки — сломается, если не учесть
- `SystemCancelExpectedStatus` сейчас `'pending_payment' | 'paid_escrow' | 'confirmed'`. Без `'processing'`
  вызов `requestSystemOrderCancel` с `expectedFromStatus: 'processing'` не скомпилируется.
- `requestSystemOrderCancel` читает `await response.json()` и ждёт `{ data: … }`. В тестах мок `fetch`
  для жёсткого джоба обязан вернуть объект с `ok`, `status` и `json()` (каркас в разделе 3.7).
- Импорты вне своей папки в `apps/worker` помечаются
  `// eslint-disable-next-line no-restricted-imports -- …` — эти строки уже есть в тексте модуля
  в разделе 3.4, копируй их как есть.

## 3. Образцы — точные тексты и правки

### 3.1 Новый файл `picking-sla-watchdog.types.ts`

```ts
/**
 * DTJ-307 (EP-12) — очередь `picking-sla-watchdog`. Своя копия строк и формы данных из apps/api
 * `infrastructure/jobs/sla-watchdog.processor.ts`: отдельные TS-проекты, меняется в обоих файлах сразу.
 */
export const PICKING_SLA_JOB_SOFT = 'soft'
export const PICKING_SLA_JOB_HARD = 'hard'

export interface PickingSlaWatchdogJobData {
  readonly orderId: string
  readonly tenantId: string
}
```

### 3.2 Новый файл `picking-sla-watchdog.job.ts`

```ts
/** DTJ-307 (EP-12, SRS-PHT-032..034) — консьюмер `picking-sla-watchdog`: soft → internal picking-sla-breach, hard → system-cancel. Статус заказа проверяет apps/api. */
import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { requestSystemOrderCancel, type SystemOrderCancelDeps } from './system-order-cancel.client.js'
import { PICKING_SLA_JOB_HARD, PICKING_SLA_JOB_SOFT, type PickingSlaWatchdogJobData } from './picking-sla-watchdog.types.js'

const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

@Injectable()
export class PickingSlaWatchdogJob {
  private readonly logger = new Logger(PickingSlaWatchdogJob.name)

  public async process(job: Job<PickingSlaWatchdogJobData>, deps: SystemOrderCancelDeps): Promise<void> {
    if (job.name === PICKING_SLA_JOB_SOFT) {
      await this.reportSoftBreach(job.data, deps)
      return
    }
    if (job.name === PICKING_SLA_JOB_HARD) {
      const result = await requestSystemOrderCancel(deps, {
        orderId: job.data.orderId,
        tenantId: job.data.tenantId,
        expectedFromStatus: 'processing',
        reason: 'pickup_sla_timeout',
      })
      this.logger.log(`picking-sla-watchdog: hard orderId=${job.data.orderId} → ${result.status}`)
      return
    }
    throw new Error(`picking-sla-watchdog: unknown job name "${job.name}"`)
  }

  private async reportSoftBreach(data: PickingSlaWatchdogJobData, deps: SystemOrderCancelDeps): Promise<void> {
    if (deps.internalApiKey === undefined) {
      // Ошибка конфигурации — бросает, не молчит (тот же приём, что requestSystemOrderCancel).
      throw new Error('INTERNAL_API_KEY is not configured — cannot call internal picking-sla-breach endpoint')
    }
    const url = new URL(`/api/v1/internal/orders/${data.orderId}/picking-sla-breach`, deps.apiInternalUrl)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [INTERNAL_API_KEY_HEADER]: deps.internalApiKey },
      body: JSON.stringify({ tenantId: data.tenantId }),
    })
    if (!response.ok) {
      throw new Error(
        `picking-sla-watchdog: picking-sla-breach POST failed for orderId=${data.orderId} (HTTP ${String(response.status)})`,
      )
    }
    this.logger.log(`picking-sla-watchdog: soft orderId=${data.orderId} reported (or already progressed)`)
  }
}
```

### 3.3 Правка `system-order-cancel.client.ts`

НАЙДИ:
```ts
export type SystemCancelExpectedStatus = 'pending_payment' | 'paid_escrow' | 'confirmed'
```
ЗАМЕНИ НА:
```ts
export type SystemCancelExpectedStatus = 'pending_payment' | 'paid_escrow' | 'confirmed' | 'processing'
```

### 3.4 Новый файл `picking-sla-watchdog.module.ts`

```ts
/** DTJ-307 (EP-12) — Worker очереди `picking-sla-watchdog`. Образец — `partial-fulfillment-timeout.module.ts`. */
import { Inject, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { QUEUE_NAMES } from '../../queues/queue.constants.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import type { WorkerEnv } from '../../config/env.schema.js'
import { PickingSlaWatchdogJob } from './picking-sla-watchdog.job.js'
import type { PickingSlaWatchdogJobData } from './picking-sla-watchdog.types.js'

@Injectable()
class PickingSlaWatchdogWorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PickingSlaWatchdogWorkerRunner.name)
  private worker: Worker<PickingSlaWatchdogJobData> | undefined

  public constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(ConfigService) private readonly configService: ConfigService<WorkerEnv, true>,
    @Inject(PickingSlaWatchdogJob) private readonly job: PickingSlaWatchdogJob,
  ) {}

  public onModuleInit(): void {
    this.worker = new Worker<PickingSlaWatchdogJobData>(
      QUEUE_NAMES.PICKING_SLA_WATCHDOG,
      (bullJob: Job<PickingSlaWatchdogJobData>) => this.handle(bullJob),
      { connection: this.connection },
    )
    this.worker.on('failed', (bullJob, error) => {
      this.logger.error(
        `picking-sla-watchdog: job ${bullJob?.id ?? '?'} (${bullJob?.name ?? '?'}, orderId=${bullJob?.data.orderId ?? '?'}) failed — ${error.message}`,
      )
    })
  }

  private async handle(bullJob: Job<PickingSlaWatchdogJobData>): Promise<void> {
    await this.job.process(bullJob, {
      apiInternalUrl: this.configService.get('API_INTERNAL_URL', { infer: true }),
      internalApiKey: this.configService.get('INTERNAL_API_KEY', { infer: true }),
    })
  }

  public async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}

@Module({
  providers: [PickingSlaWatchdogJob, PickingSlaWatchdogWorkerRunner],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: класс существует только как носитель декоратора @Module для графа DI NestJS — штатный паттерн фреймворка.
export class PickingSlaWatchdogModule {}
```

### 3.5 Правка `queues/queue.constants.ts`

НАЙДИ:
```ts
  PARTIAL_FULFILLMENT_TIMEOUT: 'partial-fulfillment-timeout',
} as const
```
ЗАМЕНИ НА:
```ts
  PARTIAL_FULFILLMENT_TIMEOUT: 'partial-fulfillment-timeout',
  /** DTJ-307 (EP-12). Producer — apps/api `infrastructure/jobs/sla-watchdog.processor.ts` (`SLA_WATCHDOG_QUEUE_NAME`, своя копия строки). Consumer — `jobs/escrow-timeouts/picking-sla-watchdog.job.ts`. */
  PICKING_SLA_WATCHDOG: 'picking-sla-watchdog',
} as const
```

### 3.6 Правка `app.module.ts` — две правки

Правка 1. НАЙДИ:
```ts
import { PartialFulfillmentTimeoutModule } from './jobs/escrow-timeouts/partial-fulfillment-timeout.module.js'
```
ЗАМЕНИ НА:
```ts
import { PartialFulfillmentTimeoutModule } from './jobs/escrow-timeouts/partial-fulfillment-timeout.module.js'
import { PickingSlaWatchdogModule } from './jobs/escrow-timeouts/picking-sla-watchdog.module.js'
```

Правка 2. НАЙДИ:
```ts
    PartialFulfillmentTimeoutModule,
  ],
```
ЗАМЕНИ НА:
```ts
    PartialFulfillmentTimeoutModule,
    PickingSlaWatchdogModule,
  ],
```

### 3.7 Каркас спека обработчика (образец — `partial-fulfillment-timeout.job.spec.ts`)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { PickingSlaWatchdogJob } from './picking-sla-watchdog.job.js'
import { PICKING_SLA_JOB_HARD, PICKING_SLA_JOB_SOFT, type PickingSlaWatchdogJobData } from './picking-sla-watchdog.types.js'

const JOB_DATA: PickingSlaWatchdogJobData = { orderId: 'order-1', tenantId: 'tenant-1' }
const DEPS = { apiInternalUrl: 'http://localhost:3000', internalApiKey: 'secret-key' }

function fakeJob(name: string): Job<PickingSlaWatchdogJobData> {
  return { id: 'job-1', name, data: JOB_DATA } as unknown as Job<PickingSlaWatchdogJobData>
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response
}

describe('PickingSlaWatchdogJob.process (DTJ-307)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // it(...) из раздела 5
})
```

### 3.8 Новый файл `picking-sla-watchdog.module.spec.ts` — полный текст

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'

function applyRequiredTestEnv(): void {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
  process.env.REDIS_URL ??= 'redis://localhost:6379/0'
  process.env.API_INTERNAL_URL ??= 'http://localhost:3000'
}

describe('PickingSlaWatchdogModule — DI-резолвинг целиком (реальный Nest-контейнер)', () => {
  beforeAll(() => {
    applyRequiredTestEnv()
  })

  it('компилируется через Test.createTestingModule(...).compile() без ошибок резолвинга зависимостей', async () => {
    const { ConfigModule } = await import('../../config/config.module.js')
    const { PickingSlaWatchdogModule } = await import('./picking-sla-watchdog.module.js')

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PickingSlaWatchdogModule],
    }).compile()

    expect(moduleRef).toBeDefined()

    await moduleRef.close()
  })
})
```

## 4. План — строго по порядку

Шаг 1. `picking-sla-watchdog.types.ts` — раздел 3.1, текст дословно.
Шаг 2. `system-order-cancel.client.ts` — раздел 3.3.
Шаг 3. `picking-sla-watchdog.job.ts` — раздел 3.2, текст дословно.
Шаг 4. `queue.constants.ts` — раздел 3.5.
Шаг 5. `picking-sla-watchdog.module.ts` — раздел 3.4, текст дословно.
Шаг 6. `app.module.ts` — раздел 3.6, обе правки.
Шаг 7. Гейт. Ожидаемо: `tsc` и `eslint` зелёные.
Шаг 8. Спек обработчика — раздел 3.7 плюс тесты из раздела 5.
Шаг 9. Спек модуля — раздел 3.8, текст дословно.
Шаг 10. Гейт. Нужен `GATE: PASS`.
Шаг 11. Сдача — раздел 8.

## 5. Тесты — что именно должно быть проверено

`picking-sla-watchdog.job.spec.ts`:
- `soft` → `fetch` вызван один раз: URL `http://localhost:3000/api/v1/internal/orders/order-1/picking-sla-breach`,
  метод `POST`, заголовок `x-internal-api-key: secret-key`, тело `{ tenantId: 'tenant-1' }`.
  Мок: `vi.fn().mockResolvedValue(jsonResponse(200, { data: { orderId: 'order-1', status: 'published' } }))`.
- `soft`, ответ 503 → `process` отклоняется с `/HTTP 503/` (BullMQ повторит джоб).
- `soft`, `internalApiKey: undefined` → отклоняется с `/INTERNAL_API_KEY/`, `fetch` не вызван.
- `hard` → `fetch` вызван один раз: URL `…/api/v1/internal/orders/order-1/system-cancel`, тело
  `{ tenantId: 'tenant-1', expectedFromStatus: 'processing', reason: 'pickup_sla_timeout' }`.
  Мок: `jsonResponse(200, { data: { orderId: 'order-1', status: 'cancelled', refundIssued: true } })` (TC-PHT-022).
- `hard`, API отвечает `{ data: { orderId: 'order-1', status: 'skipped', refundIssued: false } }` (сборка
  успела завершиться) → `process` завершается без ошибки, `fetch` вызван ровно один раз — повторной
  отмены нет (гонка complete-picking и watchdog из критериев тикета).
- `hard`, ответ 500 → отклоняется (ошибку бросает `requestSystemOrderCancel`, BullMQ повторит).
- неизвестное имя джоба (`'weird'`) → отклоняется с `/unknown job name/`, `fetch` не вызван.

`picking-sla-watchdog.module.spec.ts` — текст из раздела 3.8, модуль собирается в Nest-контейнере.

## 6. Запреты — нарушение = работа не принята

- Не комментируй и не удаляй существующий код, чтобы прошла проверка. Не заменяй `throw` на `return`.
- Не пиши `it.skip`, `@ts-ignore`, `@ts-expect-error`, `as any`. `eslint-disable` — только
  дословная копия уже существующей строки из образца с причиной после `--`.
- Не создавай новые папки, npm-пакеты, README и файлы-отчёты. Не используй express,
  `@nestjs/swagger`, jest.
- `import type` — только для того, что используется исключительно как тип. Класс, декоратор,
  функция, DI-токен → обычный `import`.
- Каждый параметр конструктора Nest-класса — с `@Inject(ТОКЕН или Класс)`. Это проверяет `test:arch`.
- Числа в коде (кроме тестов) — именованные константы (`const MS_PER_MINUTE = 60_000`).
  Функция ≤ 40 строк, файл ≤ 300 строк кода.
- Деньги — целые дирамы, не float. Время в domain и application — только через `Clock`,
  не `new Date()` и не `Date.now()`.
- Упал чужой, как кажется, тест — сначала проверь, не сломало ли его твоё изменение (порт, тип,
  конструктор). Писать «не связано с моими изменениями» можно только после этой проверки.

## 7. СТОП — прекрати работу и сдай отчёт со статусом BLOCKED, если

1. `git status --short` в начале работы не пустой.
2. `grep` не находит символ, который ты собираешься импортировать или вызвать.
3. Нужно изменить файл, которого нет в разделе 0.
4. Гейт падает с одной и той же ошибкой два раза подряд после твоих исправлений.
5. `edit` дважды ответил «file changed since it was read» — файл правит кто-то ещё.
6. Задание противоречит коду: метода, поля или файла нет там, где сказано.
7. В выводе гейта есть «ЭТО НЕ ОШИБКА КОДА: песочница dsh…» — это среда, а не твой код. Код не трогай.

BLOCKED с точной причиной — нормальный результат. Выдуманное DONE — провал.

## 8. Сдача

1. Сдача — одна команда: тот же гейт, что в разделе 1, но с `-Commit`:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1 -Allowed 'apps/worker/src/jobs/escrow-timeouts/picking-sla-watchdog.*','apps/worker/src/queues/queue.constants.ts','apps/worker/src/jobs/escrow-timeouts/system-order-cancel.client.ts','apps/worker/src/app.module.ts' -Commit "feat(worker): DTJ-307d — джоб сторожа SLA сборки"
```

   В вызове `pwsh` обязательно `timeoutMs: 600000`. Гейт сам включает полный режим и коммитит
   ТОЛЬКО при полностью зелёном прогоне, только файлы из `-Allowed` и только в твою ветку.
   Красный гейт — коммита нет: чини ошибки из вывода и запускай ту же команду снова. Сколько
   понадобится раз.
2. Ты закончил тогда и только тогда, когда в выводе есть строка `КОММИТ: <хэш> <сообщение>`,
   а последняя строка — `GATE: PASS`. Нет строки `КОММИТ:` — работа не сдана, что бы тебе ни
   казалось. Не пиши отчёт, пока её нет.
3. Ответ — строго по форме, без пересказа кода:

```
СТАТУС: DONE | BLOCKED
КОММИТ:
<строка КОММИТ: из вывода гейта, дословно>
ФАЙЛЫ:
<строки со статистикой под ней>
ГЕЙТ:
<последние 15 строк вывода гейта, дословно>
КРИТЕРИИ:
<критерий из раздела 5 → файл спека : название it(...)>
ОТКЛОНЕНИЯ: <что сделано не так, как написано, и почему — или «нет»>
БЛОКЕРЫ: <или «нет»>
```

Не пиши «успешно», «всё работает», «соответствует стилю». Не называй файлы, которых не создавал,
и не приводи вывод команд, которых не запускал.

4. Отчёт написан — работа закончена. Цель не закрывай и `update_goal` не вызывай: это делает
   координатор. Дальше ничего не делай и жди.

=== КОНЕЦ ЗАДАНИЯ DTJ-307d ===
