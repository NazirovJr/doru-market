# ЗАДАНИЕ DTJ-307c — SLA сборки: планирование двух watchdog-джобов при `accept`

> Прочитай этот файл целиком одним вызовом `read`. Инструмент сам печатает в конце вывода
> `(End of file - total N lines)` — эта пометка и значит, что файл прочитан весь;
> последняя строка файла — `=== КОНЕЦ ЗАДАНИЯ DTJ-307c ===`. Пометки нет — дочитай
> остаток через `read` с `offset` и только потом работай.
> Если история сжата или ты не помнишь следующий шаг — перечитай этот файл: `reports/qwen3/tasks/DTJ-307c.md`.

> Координатору перед отправкой: DTJ-307a и DTJ-307b влиты в `development`, ветка этого задания создана от него.

## 0. Карточка задачи

Цель: когда фармацевт принимает заказ в сборку (`AcceptOrderUseCase`), в BullMQ ставятся два
отложенных джоба. Мягкий срабатывает через `pickup_sla_minutes` (по умолчанию 7 минут), жёсткий —
через `pickup_sla_minutes + pickup_sla_buffer_minutes` (по умолчанию 12). Обрабатывать их будет
`apps/worker` в задании DTJ-307d. Здесь — только постановка в очередь.
Рабочая папка — та, что открыта в этой сессии dsh (общий репозиторий, в нём работают и другие).
Меняешь ровно эти файлы:

СОЗДАТЬ:
- `apps/api/src/modules/orders/application/ports/sla-watchdog-queue.port.ts` — порт очереди
- `apps/api/src/modules/orders/infrastructure/jobs/sla-watchdog.processor.ts` — BullMQ-продюсер
- `apps/api/src/modules/orders/infrastructure/jobs/sla-watchdog.processor.spec.ts` — его тесты
- `apps/api/src/modules/orders/application/pharmacy-terminal/schedule-sla-watchdog.use-case.ts` — use case планирования
- `apps/api/src/modules/orders/application/pharmacy-terminal/schedule-sla-watchdog.use-case.spec.ts` — его тесты

ИЗМЕНИТЬ:
- `apps/api/src/modules/orders/application/pharmacy-terminal/accept-order.use-case.ts` — вызвать планирование
- `apps/api/src/modules/orders/application/pharmacy-terminal/accept-order.use-case.spec.ts` — седьмой аргумент конструктора и тесты
- `apps/api/src/modules/orders/orders.module.ts` — зарегистрировать провайдер очереди и use case

Любой другой файл не трогай. Понадобилось — это СТОП (раздел 7).
Не делаешь: обработчики джобов (`apps/worker`, DTJ-307d), отмену и рефанд, WebSocket, интеграционный
тест с настоящим Redis (его пишет координатор).

Первое действие — `todo_write`: первый пункт — цель задания одной фразой своими словами, дальше шаги раздела 4.
Второе — `git status --short`: пусто — работай, есть чужие изменения — это СТОП (раздел 7).
Третье — своя ветка от `development`: `git checkout -b feat/dtj-307c-sla-watchdog-schedule development`.
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
5. В импортах пишется `.js` (`'./x.use-case.js'`), а на диске лежит `x.use-case.ts`. Открывай `.ts`.
6. `edit`: перед каждой правкой перечитай этот кусок файла. `old_string` копируй из вывода `read`
   дословно, без номеров строк. `new_string` обязан отличаться от `old_string`. `replace_all` не используй.
   Один вызов не должен нести больше ~100 строк кода. Пока ты пишешь аргумент, dsh не видит ни
   одного символа и через 20 минут молчания рвёт вызов. Длинный файл создавай в два-три приёма:
   `write` с шапкой и первым тестом, дальше `edit` — по одному тесту.
7. Проверка — только эта команда (в `workdir` = рабочая папка). Свои способы проверки не
   придумывай, кэши не чисти:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1 -Allowed 'apps/api/src/modules/orders/application/ports/sla-watchdog-queue.port.ts','apps/api/src/modules/orders/infrastructure/jobs/sla-watchdog.processor*','apps/api/src/modules/orders/application/pharmacy-terminal/schedule-sla-watchdog.use-case*','apps/api/src/modules/orders/application/pharmacy-terminal/accept-order.use-case*','apps/api/src/modules/orders/orders.module.ts'`
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

## 2. Проверенные факты (development @ `cd49440` + DTJ-307a + DTJ-307b, проверено координатором)

### 2.1 Уже есть — используй как есть, заново не создавай
- `TenancyFacadePort.getPickupSlaMinutes(tenantId)` (дефолт 7) и `getPickupSlaBufferMinutes(tenantId)`
  (дефолт 5, добавлен в DTJ-307b). Токен `TENANCY_FACADE_PORT`, файл `.../application/ports/tenancy-facade.port.ts`.
- Образец продюсера BullMQ — `apps/api/src/modules/orders/infrastructure/jobs/partial-fulfillment-timeout.processor.ts`
  (класс `PartialFulfillmentTimeoutProcessor`). Новый продюсер — его копия, текст ниже в разделе 3.2.
- `REDIS_CLIENT` — `import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'`.
- Образец «планировать внутри транзакции» — `ProposePartialFulfillmentUseCase`: `timeoutQueue.schedule(...)`
  вызывается ВНУТРИ колбэка `unitOfWork.run`. Если Redis упадёт, транзакция БД откатится целиком.
  Здесь делаем так же.
- `AcceptOrderUseCase.execute` целиком — это `return this.unitOfWork.run(async (tx) => { … })`.
  Вызов планирования ставится внутри этого колбэка, сразу после `ordersOutbox.appendAll(...)`.
- Константы имени очереди и имён джобов обязаны совпасть с `apps/worker` (DTJ-307d):
  очередь `'picking-sla-watchdog'`, джобы `'soft'` и `'hard'`, данные `{ orderId, tenantId }`.

### 2.2 Этого НЕТ — не выдумывай, не ищи
- Нет подписчиков на `OrderProcessingStartedEvent`: outbox-relay в `apps/worker` — заглушка, события никуда
  не доставляются. Поэтому планирование — прямой вызов из `AcceptOrderUseCase`, а не подписка.
- Нет `Worker` BullMQ внутри `apps/api` и не должно быть — консьюмер живёт в `apps/worker`.
- Имя `PickupSlaTimeoutJob` уже занято в `apps/worker` другой джобой (DTJ-254). Здесь его не используй.

### 2.3 Ловушки — сломается, если не учесть
- BullMQ 6 бросает `Custom Id cannot contain :` на `jobId` с двоеточием. `jobId` только через дефис:
  `sla-soft-<orderId>` и `sla-hard-<orderId>`. Тикет пишет `'soft:' + orderId` — это ошибка тикета, так НЕ делать.
- `AcceptOrderUseCase` создаётся в `accept-order.use-case.spec.ts` позиционно:
  `new AcceptOrderUseCase(repo, new PassthroughUnitOfWork(), ordersOutbox, inventoryFacade, tenancyFacade, new FixedClock())`.
  После добавления седьмого параметра конструктора этот вызов обязан получить седьмой аргумент (раздел 3.5, правка 3).
- У `AcceptOrderUseCase` уже есть `eslint-disable-next-line max-params` с причиной. Причину обнови
  (раздел 3.4, правка 2), новую строку `eslint-disable` не добавляй.

## 3. Образцы — точные тексты и правки

### 3.1 Новый порт — полный текст `sla-watchdog-queue.port.ts`

```ts
/** DTJ-307 (EP-12, SRS-PHT-032/033) — планирование двух BullMQ delayed job SLA сборки. Реализация — `SlaWatchdogProcessor`. */
export const SLA_WATCHDOG_QUEUE = Symbol.for('@dorutj/orders/sla-watchdog-queue')

export interface ScheduleSlaWatchdogJobsInput {
  readonly orderId: string
  readonly tenantId: string
  /** Мягкое нарушение: `pickup_sla_minutes`. */
  readonly softDelayMinutes: number
  /** Жёсткий автоотказ: `pickup_sla_minutes + pickup_sla_buffer_minutes`. */
  readonly hardDelayMinutes: number
}

export interface SlaWatchdogQueuePort {
  schedule(input: ScheduleSlaWatchdogJobsInput): Promise<void>
}
```

### 3.2 Новый продюсер — полный текст `sla-watchdog.processor.ts`

```ts
/** DTJ-307 (EP-12, SRS-PHT-032/033) — producer очереди `picking-sla-watchdog`, consumer — apps/worker. Образец — `PartialFulfillmentTimeoutProcessor`. */
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { Queue, type JobsOptions } from 'bullmq'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import {
  SLA_WATCHDOG_QUEUE,
  type ScheduleSlaWatchdogJobsInput,
  type SlaWatchdogQueuePort,
} from '@/modules/orders/application/ports/sla-watchdog-queue.port.js'

/** Своя копия строк есть в apps/worker (`picking-sla-watchdog.types.ts`): отдельные TS-проекты, синхронизируется вручную. */
export const SLA_WATCHDOG_QUEUE_NAME = 'picking-sla-watchdog'
export const SLA_WATCHDOG_JOB_SOFT = 'soft'
export const SLA_WATCHDOG_JOB_HARD = 'hard'

const MS_PER_MINUTE = 60_000
const JOB_ATTEMPTS = 5
const JOB_BACKOFF_DELAY_MS = 5_000
const REMOVE_ON_COMPLETE_AGE_SECONDS = 86_400
const REMOVE_ON_COMPLETE_COUNT = 10_000
const REMOVE_ON_FAIL_AGE_SECONDS = 604_800

export interface SlaWatchdogJobData {
  readonly orderId: string
  readonly tenantId: string
}

const JOB_OPTIONS: Omit<JobsOptions, 'delay' | 'jobId'> = {
  attempts: JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: JOB_BACKOFF_DELAY_MS },
  removeOnComplete: { age: REMOVE_ON_COMPLETE_AGE_SECONDS, count: REMOVE_ON_COMPLETE_COUNT },
  removeOnFail: { age: REMOVE_ON_FAIL_AGE_SECONDS },
}

/** Без «:» — BullMQ 6 бросает `Custom Id cannot contain :`. Один заказ — один мягкий и один жёсткий джоб. */
export function slaWatchdogJobId(kind: typeof SLA_WATCHDOG_JOB_SOFT | typeof SLA_WATCHDOG_JOB_HARD, orderId: string): string {
  return `sla-${kind}-${orderId}`
}

@Injectable()
export class SlaWatchdogProcessor implements SlaWatchdogQueuePort, OnModuleDestroy {
  private readonly queue: Queue<SlaWatchdogJobData>

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<SlaWatchdogJobData>(SLA_WATCHDOG_QUEUE_NAME, { connection: redis })
  }

  async schedule(input: ScheduleSlaWatchdogJobsInput): Promise<void> {
    const data: SlaWatchdogJobData = { orderId: input.orderId, tenantId: input.tenantId }
    await this.queue.add(SLA_WATCHDOG_JOB_SOFT, data, {
      ...JOB_OPTIONS,
      jobId: slaWatchdogJobId(SLA_WATCHDOG_JOB_SOFT, input.orderId),
      delay: input.softDelayMinutes * MS_PER_MINUTE,
    })
    await this.queue.add(SLA_WATCHDOG_JOB_HARD, data, {
      ...JOB_OPTIONS,
      jobId: slaWatchdogJobId(SLA_WATCHDOG_JOB_HARD, input.orderId),
      delay: input.hardDelayMinutes * MS_PER_MINUTE,
    })
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}

export const SLA_WATCHDOG_QUEUE_PROVIDER = {
  provide: SLA_WATCHDOG_QUEUE,
  useClass: SlaWatchdogProcessor,
} as const
```

### 3.3 Новый use case — полный текст `schedule-sla-watchdog.use-case.ts`

```ts
/** DTJ-307 (EP-12, SRS-PHT-032/033, D-19) — при accept ставит два delayed job SLA сборки: мягкий через pickup_sla, жёсткий через pickup_sla + buffer. */
import { Inject, Injectable } from '@nestjs/common'
import { TENANCY_FACADE_PORT, type TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import { SLA_WATCHDOG_QUEUE, type SlaWatchdogQueuePort } from '@/modules/orders/application/ports/sla-watchdog-queue.port.js'

export interface ScheduleSlaWatchdogCommand {
  readonly orderId: string
  readonly tenantId: string
}

@Injectable()
export class ScheduleSlaWatchdogUseCase {
  constructor(
    @Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort,
    @Inject(SLA_WATCHDOG_QUEUE) private readonly slaWatchdogQueue: SlaWatchdogQueuePort,
  ) {}

  async execute(cmd: ScheduleSlaWatchdogCommand): Promise<void> {
    const slaMinutes = await this.tenancyFacade.getPickupSlaMinutes(cmd.tenantId)
    const bufferMinutes = await this.tenancyFacade.getPickupSlaBufferMinutes(cmd.tenantId)
    await this.slaWatchdogQueue.schedule({
      orderId: cmd.orderId,
      tenantId: cmd.tenantId,
      softDelayMinutes: slaMinutes,
      hardDelayMinutes: slaMinutes + bufferMinutes,
    })
  }
}
```

### 3.4 Правки `accept-order.use-case.ts` — три правки

Правка 1 (импорт). НАЙДИ:
```ts
import type { OrderDomainEvent } from '@/modules/orders/domain/order-domain-event.js'
```
ЗАМЕНИ НА:
```ts
import type { OrderDomainEvent } from '@/modules/orders/domain/order-domain-event.js'
import { ScheduleSlaWatchdogUseCase } from '@/modules/orders/application/pharmacy-terminal/schedule-sla-watchdog.use-case.js'
```

Правка 2 (конструктор). НАЙДИ:
```ts
  // eslint-disable-next-line max-params -- 5 портов + Clock, тот же приём, что CancelOrderUseCase (явные @Inject, граф виден в providers[]).
```
ЗАМЕНИ НА:
```ts
  // eslint-disable-next-line max-params -- 5 портов + Clock + ScheduleSlaWatchdogUseCase (DTJ-307), тот же приём, что CancelOrderUseCase (явные @Inject, граф виден в providers[]).
```
Затем НАЙДИ:
```ts
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}
```
ЗАМЕНИ НА:
```ts
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ScheduleSlaWatchdogUseCase) private readonly scheduleSlaWatchdog: ScheduleSlaWatchdogUseCase,
  ) {}
```

Правка 3 (вызов внутри транзакции). НАЙДИ:
```ts
      await this.ordersOutbox.appendAll(cmd.actor.tenantId, [...order.pullDomainEvents(), claimedEvent], tx)
```
ЗАМЕНИ НА:
```ts
      await this.ordersOutbox.appendAll(cmd.actor.tenantId, [...order.pullDomainEvents(), claimedEvent], tx)
      // DTJ-307: внутри транзакции, как schedule в ProposePartialFulfillmentUseCase — сбой Redis откатывает accept.
      await this.scheduleSlaWatchdog.execute({ orderId: cmd.orderId, tenantId: cmd.actor.tenantId })
```

### 3.5 Правки `accept-order.use-case.spec.ts` — четыре правки

Правка 1 (импорт). НАЙДИ:
```ts
import { AcceptOrderUseCase, type AcceptOrderActor } from './accept-order.use-case.js'
```
ЗАМЕНИ НА:
```ts
import { AcceptOrderUseCase, type AcceptOrderActor } from './accept-order.use-case.js'
import type { ScheduleSlaWatchdogUseCase } from './schedule-sla-watchdog.use-case.js'
```

Правка 2 (интерфейс Harness). НАЙДИ:
```ts
  readonly getPickupSlaMinutes: ReturnType<typeof vi.fn<TenancyFacadePort['getPickupSlaMinutes']>>
}
```
ЗАМЕНИ НА:
```ts
  readonly getPickupSlaMinutes: ReturnType<typeof vi.fn<TenancyFacadePort['getPickupSlaMinutes']>>
  readonly scheduleSlaWatchdog: ReturnType<typeof vi.fn<ScheduleSlaWatchdogUseCase['execute']>>
}
```

Правка 3 (конструктор в `makeHarness`). НАЙДИ:
```ts
  const useCase = new AcceptOrderUseCase(repo, new PassthroughUnitOfWork(), ordersOutbox, inventoryFacade, tenancyFacade, new FixedClock())
  return { useCase, repo, appendAll, hasExpiredReservedBatch, getPickupSlaMinutes }
```
ЗАМЕНИ НА:
```ts
  const scheduleSlaWatchdog = vi.fn<ScheduleSlaWatchdogUseCase['execute']>().mockResolvedValue(undefined)
  const useCase = new AcceptOrderUseCase(
    repo,
    new PassthroughUnitOfWork(),
    ordersOutbox,
    inventoryFacade,
    tenancyFacade,
    new FixedClock(),
    { execute: scheduleSlaWatchdog } as unknown as ScheduleSlaWatchdogUseCase,
  )
  return { useCase, repo, appendAll, hasExpiredReservedBatch, getPickupSlaMinutes, scheduleSlaWatchdog }
```

Правка 4 — новый `describe` в самый конец файла (после последней `})`), тесты из раздела 5.

### 3.6 Регистрация в `orders.module.ts` — две правки

Правка 1 (импорты). НАЙДИ:
```ts
import { PickingSlaBreachController } from './presentation/internal/picking-sla-breach.controller.js'
```
ЗАМЕНИ НА:
```ts
import { PickingSlaBreachController } from './presentation/internal/picking-sla-breach.controller.js'
// DTJ-307 (EP-12, SLA сборки) — постановка мягкого и жёсткого watchdog-джоба при accept.
import { ScheduleSlaWatchdogUseCase } from './application/pharmacy-terminal/schedule-sla-watchdog.use-case.js'
import { SLA_WATCHDOG_QUEUE_PROVIDER } from './infrastructure/jobs/sla-watchdog.processor.js'
```

Правка 2 (провайдеры). НАЙДИ:
```ts
    // DTJ-307 (EP-12, SLA сборки, см. JSDoc импортов выше).
    ReportPickingSlaBreachUseCase,
  ],
```
ЗАМЕНИ НА:
```ts
    // DTJ-307 (EP-12, SLA сборки, см. JSDoc импортов выше).
    ReportPickingSlaBreachUseCase,
    SLA_WATCHDOG_QUEUE_PROVIDER,
    ScheduleSlaWatchdogUseCase,
  ],
```

### 3.7 Каркас спека продюсера (образец — `partial-fulfillment-timeout.processor.spec.ts`)

```ts
import { describe, expect, it, vi } from 'vitest'
import type Redis from 'ioredis'
import { SlaWatchdogProcessor, SLA_WATCHDOG_JOB_HARD, SLA_WATCHDOG_JOB_SOFT } from './sla-watchdog.processor.js'

interface FakeQueue {
  add: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function makeProcessor(): { processor: SlaWatchdogProcessor; addMock: ReturnType<typeof vi.fn>; closeMock: ReturnType<typeof vi.fn> } {
  const addMock = vi.fn().mockResolvedValue(undefined)
  const closeMock = vi.fn().mockResolvedValue(undefined)
  const processor = new SlaWatchdogProcessor({} as unknown as Redis)
  ;(processor as unknown as { queue: FakeQueue }).queue = { add: addMock, close: closeMock }
  return { processor, addMock, closeMock }
}

// describe/it из раздела 5
```

### 3.8 Каркас спека use case

```ts
import { describe, expect, it, vi } from 'vitest'
import type { TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import type { SlaWatchdogQueuePort } from '@/modules/orders/application/ports/sla-watchdog-queue.port.js'
import { ScheduleSlaWatchdogUseCase } from './schedule-sla-watchdog.use-case.js'

const TENANT_ID = 'tenant-1'
const ORDER_ID = 'order-1'

function makeHarness(slaMinutes: number, bufferMinutes: number) {
  const schedule = vi.fn<SlaWatchdogQueuePort['schedule']>().mockResolvedValue(undefined)
  const getPickupSlaMinutes = vi.fn<TenancyFacadePort['getPickupSlaMinutes']>().mockResolvedValue(slaMinutes)
  const getPickupSlaBufferMinutes = vi.fn<TenancyFacadePort['getPickupSlaBufferMinutes']>().mockResolvedValue(bufferMinutes)
  const tenancyFacade: TenancyFacadePort = {
    resolveCommissionRate: vi.fn(),
    getCodLimitDiram: vi.fn(),
    getEnabledPaymentMethods: vi.fn(),
    getPickupSlaMinutes,
    getPickupSlaBufferMinutes,
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
    getHandoverOtpMaxRegenerationsPerOrder: vi.fn(),
    getHandoverOtpRegenerateMinIntervalSeconds: vi.fn(),
  }
  const useCase = new ScheduleSlaWatchdogUseCase(tenancyFacade, { schedule })
  return { useCase, schedule, getPickupSlaMinutes, getPickupSlaBufferMinutes }
}

// describe/it из раздела 5
```

## 4. План — строго по порядку

Шаг 1. Порт — раздел 3.1, текст дословно.
Шаг 2. Продюсер — раздел 3.2, текст дословно.
Шаг 3. Use case — раздел 3.3, текст дословно.
Шаг 4. `accept-order.use-case.ts` — раздел 3.4, все правки.
Шаг 5. `orders.module.ts` — раздел 3.6, обе правки.
Шаг 6. `accept-order.use-case.spec.ts` — раздел 3.5, правки 1–3 (без новых тестов).
Шаг 7. Гейт. Ожидаемо: `tsc`, `eslint` и старые тесты accept зелёные.
Шаг 8. Спек продюсера — раздел 3.7 плюс тесты из раздела 5.
Шаг 9. Спек use case — раздел 3.8 плюс тесты из раздела 5.
Шаг 10. Новые тесты accept — раздел 3.5, правка 4.
Шаг 11. Гейт. Нужен `GATE: PASS`.
Шаг 12. Сдача — раздел 8.

## 5. Тесты — что именно должно быть проверено

`sla-watchdog.processor.spec.ts` (`describe('SlaWatchdogProcessor.schedule (DTJ-307)', …)`):
- `schedule({ orderId: 'order-1', tenantId: 'tenant-1', softDelayMinutes: 7, hardDelayMinutes: 12 })` →
  `add` вызван дважды. Первый вызов: имя `SLA_WATCHDOG_JOB_SOFT`, данные `{ orderId: 'order-1', tenantId: 'tenant-1' }`,
  `jobId: 'sla-soft-order-1'`, `delay: 420_000`. Второй: `SLA_WATCHDOG_JOB_HARD`, те же данные,
  `jobId: 'sla-hard-order-1'`, `delay: 720_000`.
- оба `jobId` не содержат `':'` (`expect(jobId).not.toContain(':')`) — ограничение BullMQ.
- повторный `schedule` для того же заказа даёт те же два `jobId` (дедупликация — BullMQ по `jobId`).
- `onModuleDestroy` вызывает `queue.close()` один раз.

`schedule-sla-watchdog.use-case.spec.ts` (`describe('ScheduleSlaWatchdogUseCase (DTJ-307, D-19)', …)`):
- дефолты 7 и 5 → `schedule` вызван ровно с `{ orderId, tenantId, softDelayMinutes: 7, hardDelayMinutes: 12 }`.
- настройки тенанта 10 и 3 → `softDelayMinutes: 10`, `hardDelayMinutes: 13` (значения из `tenant_settings`, не константы).
- оба геттера вызваны с `TENANT_ID`.
- `schedule` бросает `new Error('redis down')` → `execute` отклоняется с этой ошибкой (не глотает).

`accept-order.use-case.spec.ts` — новый `describe('AcceptOrderUseCase — SLA watchdog (DTJ-307, TC-PHT-021/022)', …)`:
- успешный accept (`paid_escrow`, `PHARMACIST_A`) → `scheduleSlaWatchdog` вызван ровно один раз с
  `{ orderId: order.id, tenantId: TENANT_ID }`.
- заказ уже принят другим фармацевтом (как в тесте «гонка»: `orderAtStatus('processing', { processingStartedAt: NOW })`,
  `repo.seed(order, { id: PHARMACIST_A.userId, name: 'Фарзона М.' })`, вызывает `PHARMACIST_B`) → `scheduleSlaWatchdog` не вызван.
- фармацевт чужой аптеки (`PHARMACIST_OTHER_PHARMACY`) → `ForbiddenError`, `scheduleSlaWatchdog` не вызван.
- `scheduleSlaWatchdog.mockRejectedValueOnce(new Error('redis down'))` → `execute` отклоняется с `'redis down'`
  (планирование внутри транзакции — accept не проходит без таймеров).

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
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1 -Allowed 'apps/api/src/modules/orders/application/ports/sla-watchdog-queue.port.ts','apps/api/src/modules/orders/infrastructure/jobs/sla-watchdog.processor*','apps/api/src/modules/orders/application/pharmacy-terminal/schedule-sla-watchdog.use-case*','apps/api/src/modules/orders/application/pharmacy-terminal/accept-order.use-case*','apps/api/src/modules/orders/orders.module.ts' -Commit "feat(orders): DTJ-307c — планирование сторожей SLA сборки при приёме заказа"
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

=== КОНЕЦ ЗАДАНИЯ DTJ-307c ===
