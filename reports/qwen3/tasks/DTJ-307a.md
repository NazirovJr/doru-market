# ЗАДАНИЕ DTJ-307a — SLA сборки: событие SlaBreachedEvent и internal-эндпоинт мягкого нарушения

> Прочитай этот файл целиком одним вызовом `read`. Инструмент сам печатает в конце вывода
> `(End of file - total N lines)` — эта пометка и значит, что файл прочитан весь;
> последняя строка файла — `=== КОНЕЦ ЗАДАНИЯ DTJ-307a ===`. Пометки нет — дочитай
> остаток через `read` с `offset` и только потом работай.
> Если история сжата или ты не помнишь следующий шаг — перечитай этот файл: `reports/qwen3/tasks/DTJ-307a.md`.

## 0. Карточка задачи

Цель: в `apps/api` появляется `POST /api/v1/internal/orders/:id/picking-sla-breach`. Если заказ
всё ещё в статусе `processing`, эндпоинт кладёт в outbox событие `SlaBreachedEvent`. Если статус
другой, ничего не делает и отвечает `skipped`. Заодно system-cancel начинает принимать
`expectedFromStatus: 'processing'`.
Рабочая папка — та, что открыта в этой сессии dsh (общий репозиторий, в нём работают и другие).
Меняешь ровно эти файлы:

СОЗДАТЬ:
- `apps/api/src/modules/orders/application/pharmacy-terminal/report-picking-sla-breach.use-case.ts` — use case
- `apps/api/src/modules/orders/application/pharmacy-terminal/report-picking-sla-breach.use-case.spec.ts` — его тесты
- `apps/api/src/modules/orders/presentation/internal/picking-sla-breach.controller.ts` — internal-контроллер
- `apps/api/src/modules/orders/presentation/internal/picking-sla-breach.controller.spec.ts` — его тесты

ИЗМЕНИТЬ:
- `apps/api/src/modules/orders/domain/order-domain-event.ts` — новый вариант union `SlaBreachedEvent`
- `apps/api/src/modules/orders/domain/order-domain-event.spec.ts` — реестр вариантов: добавить `SlaBreachedEvent`
- `apps/api/src/modules/orders/presentation/internal/system-cancel-order.controller.ts` — `'processing'` в `z.enum`
- `apps/api/src/modules/orders/presentation/internal/system-cancel-order.controller.spec.ts` — тест на `'processing'`
- `apps/api/src/modules/orders/orders.module.ts` — зарегистрировать use case и контроллер

Любой другой файл не трогай. Понадобилось — это СТОП (раздел 7).
Не делаешь: планирование джобов BullMQ, `apps/worker`, WebSocket, отмену заказа — это задания
DTJ-307c и DTJ-307d.

Первое действие — `todo_write`: первый пункт — цель задания одной фразой своими словами, дальше шаги раздела 4.
Второе — `git status --short`: пусто — работай, есть чужие изменения — это СТОП (раздел 7).
Третье — своя ветка от `development`: `git checkout -b feat/dtj-307a-sla-soft-breach development`.
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
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1 -Allowed 'apps/api/src/modules/orders/domain/order-domain-event*','apps/api/src/modules/orders/application/pharmacy-terminal/report-picking-sla-breach.use-case*','apps/api/src/modules/orders/presentation/internal/picking-sla-breach.controller*','apps/api/src/modules/orders/presentation/internal/system-cancel-order.controller*','apps/api/src/modules/orders/orders.module.ts'`
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

## 2. Проверенные факты (коммит `cd49440`, проверено координатором)

### 2.1 Уже есть — используй как есть, заново не создавай
- `OrderRepositoryPort.findById(tenantId: string, orderId: string, tx?): Promise<Order | null>`.
  Токен `ORDER_REPOSITORY_PORT`, файл `apps/api/src/modules/orders/application/ports/order-repository.port.ts`.
- `OrdersUnitOfWorkPort.run<T>(callback: (tx) => Promise<T>): Promise<T>`. Токен `ORDERS_UNIT_OF_WORK`,
  файл `.../application/ports/unit-of-work.port.ts`.
- `OrdersOutboxPort.appendAll(tenantId: string, events: readonly OrderDomainEvent[], tx): Promise<void>`.
  Токен `ORDERS_OUTBOX`, файл `.../application/ports/orders-outbox.port.ts`. Без `tx` не вызывается,
  поэтому запись в outbox делается внутри `unitOfWork.run`.
- `TenancyFacadePort.getPickupSlaMinutes(tenantId): Promise<number>` (дефолт 7). Токен
  `TENANCY_FACADE_PORT`, файл `.../application/ports/tenancy-facade.port.ts`.
- `Clock.now(): Date`, токен `CLOCK`. Импорт:
  `import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'`
- `NotFoundError` — `import { NotFoundError } from '@dorutj/contracts'`. Конструктор принимает объект
  деталей: `new NotFoundError({ resource: 'order', orderId })`.
- `Order` — `order.id`, `order.status` (геттеры). Тип `OrderStatus` включает `'processing'`.
- `InternalServiceGuard` — `apps/api/src/modules/orders/presentation/internal/internal-service.guard.ts`,
  проверяет заголовок `x-internal-api-key`. Уже зарегистрирован в `orders.module.ts`, повторно не регистрируй.
- Тестовые хелперы: `InMemoryOrderRepository` (`@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js`,
  методы `seed(order)`, `findById`), `validOrderCreateCommand`
  (`@/modules/orders/testing/fixtures/order-create-command.fixture.js`).
- В модуле support уже есть событие с тем же именем `SlaBreachedEvent` и полями
  `entityType`, `entityId`, `breachedAt`, `slaMinutes` (SRS). WS-маршрут `ops.sla_breached` общий,
  поэтому форма полей должна совпадать: берём те же четыре поля плюс `orderId`.

### 2.2 Этого НЕТ — не выдумывай, не ищи
- Нет WebSocket-шлюза и маршрута `ops.sla_breached` в коде — событие только в outbox, WS делает DTJ-308.
- Нет события `OrderAutoCancelledEvent` и причины `pickup_sla_exceeded` — в этом задании они не нужны.
- Нет папки `domain/events/` в модуле orders. Все события заказа — варианты одного union в
  `order-domain-event.ts`. Новых файлов событий не создавай.
- Нет метода у `Order`, который публикует `SlaBreachedEvent`. Событие строит use case, `order.entity.ts` не трогай.

### 2.3 Ловушки — сломается, если не учесть
- В `order-domain-event.spec.ts` есть реестр `ALL_EVENT_TYPES: Record<OrderDomainEvent['type'], true>`
  и отсортированный список имён. Новый вариант union без записи в обоих местах → красный `tsc` и тест.
- `SystemCancelOrderRequestSchema` в `system-cancel-order.controller.ts` не экспортируется. Тип тела
  выводится из схемы, поэтому тест контроллера с `'processing'` компилируется только после правки `z.enum`.

## 3. Образцы — копируй структуру, длинные JSDoc не копируй

### 3.1 Правка union в `order-domain-event.ts`

НАЙДИ (конец union, дословно):
```ts
      readonly type: 'HandoverOtpRegeneratedEvent'
      readonly orderId: string
      readonly deliveryAssignmentId: string | null
      readonly regeneratedAt: Date
      readonly regenerationsUsed: number
    }
```
ЗАМЕНИ НА:
```ts
      readonly type: 'HandoverOtpRegeneratedEvent'
      readonly orderId: string
      readonly deliveryAssignmentId: string | null
      readonly regeneratedAt: Date
      readonly regenerationsUsed: number
    }
  /** DTJ-307 (SRS-PHT-032/034) — мягкое нарушение SLA сборки. Поля как у `SlaBreachedEvent` модуля support + `orderId` для outbox. */
  | {
      readonly type: 'SlaBreachedEvent'
      readonly orderId: string
      readonly entityType: 'pharmacy_order'
      readonly entityId: string
      readonly breachedAt: Date
      readonly slaMinutes: number
    }
```

### 3.2 Правка реестра в `order-domain-event.spec.ts`

Две правки. Первая — НАЙДИ `  HandoverOtpRegeneratedEvent: true,` и ЗАМЕНИ НА:
```ts
  HandoverOtpRegeneratedEvent: true,
  SlaBreachedEvent: true,
```
Вторая — НАЙДИ `        'HandoverOtpRegeneratedEvent',` (с восемью пробелами в начале, внутри `.toEqual([`) и ЗАМЕНИ НА:
```ts
        'HandoverOtpRegeneratedEvent',
        'SlaBreachedEvent',
```

### 3.3 Новый use case — полный текст файла `report-picking-sla-breach.use-case.ts`

```ts
/** DTJ-307 (EP-12, SRS-PHT-032/034) — мягкое нарушение SLA сборки: заказ всё ещё `processing` → `SlaBreachedEvent` в outbox. */
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
} from '@/modules/orders/application/ports/order-repository.port.js'
import { ORDERS_UNIT_OF_WORK, type OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import { ORDERS_OUTBOX, type OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import { TENANCY_FACADE_PORT, type TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import type { OrderDomainEvent } from '@/modules/orders/domain/order-domain-event.js'

export interface ReportPickingSlaBreachCommand {
  readonly tenantId: string
  readonly orderId: string
}

export interface ReportPickingSlaBreachResult {
  readonly orderId: string
  readonly status: 'published' | 'skipped'
}

@Injectable()
export class ReportPickingSlaBreachUseCase {
  // eslint-disable-next-line max-params -- 4 порта + Clock, тот же приём, что AcceptOrderUseCase (явные @Inject, граф виден в providers[]).
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDERS_UNIT_OF_WORK) private readonly unitOfWork: OrdersUnitOfWorkPort,
    @Inject(ORDERS_OUTBOX) private readonly ordersOutbox: OrdersOutboxPort,
    @Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(cmd: ReportPickingSlaBreachCommand): Promise<ReportPickingSlaBreachResult> {
    const order = await this.orderRepository.findById(cmd.tenantId, cmd.orderId)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }
    // Сборка уже завершена, отменена или ещё не начата — нарушения нет, повторный или запоздалый джоб ничего не делает.
    if (order.status !== 'processing') {
      return { orderId: cmd.orderId, status: 'skipped' }
    }
    const slaMinutes = await this.tenancyFacade.getPickupSlaMinutes(cmd.tenantId)
    const event: OrderDomainEvent = {
      type: 'SlaBreachedEvent',
      orderId: order.id,
      entityType: 'pharmacy_order',
      entityId: order.id,
      breachedAt: this.clock.now(),
      slaMinutes,
    }
    await this.unitOfWork.run((tx) => this.ordersOutbox.appendAll(cmd.tenantId, [event], tx))
    return { orderId: cmd.orderId, status: 'published' }
  }
}
```

### 3.4 Новый контроллер — полный текст файла `picking-sla-breach.controller.ts`

Образец — `system-cancel-order.controller.ts` в той же папке.

```ts
/** DTJ-307 (EP-12) — мост apps/worker → apps/api: мягкое нарушение SLA сборки (`InternalServiceGuard`, как system-cancel). */
import { Body, Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import {
  ReportPickingSlaBreachUseCase,
  type ReportPickingSlaBreachResult,
} from '@/modules/orders/application/pharmacy-terminal/report-picking-sla-breach.use-case.js'
import { InternalServiceGuard } from './internal-service.guard.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

const PickingSlaBreachRequestSchema = z.object({
  tenantId: z.uuid(),
})
type PickingSlaBreachRequest = z.infer<typeof PickingSlaBreachRequestSchema>

@Controller({ path: 'internal/orders', version: '1' })
@UseGuards(InternalServiceGuard)
export class PickingSlaBreachController {
  public constructor(
    @Inject(ReportPickingSlaBreachUseCase) private readonly reportPickingSlaBreach: ReportPickingSlaBreachUseCase,
  ) {}

  @Post(':id/picking-sla-breach')
  @HttpCode(HttpStatus.OK)
  public async report(
    @Param('id', ID_PARSE_UUID) orderId: string,
    @Body(new ZodValidationPipe(PickingSlaBreachRequestSchema)) body: PickingSlaBreachRequest,
  ): Promise<SuccessEnvelope<ReportPickingSlaBreachResult>> {
    const result = await this.reportPickingSlaBreach.execute({ tenantId: body.tenantId, orderId })
    return ok(result)
  }
}
```

### 3.5 Правка схемы в `system-cancel-order.controller.ts`

НАЙДИ:
```ts
  expectedFromStatus: z.enum(['pending_payment', 'paid_escrow', 'confirmed']),
```
ЗАМЕНИ НА:
```ts
  expectedFromStatus: z.enum(['pending_payment', 'paid_escrow', 'confirmed', 'processing']),
```

### 3.6 Регистрация в `orders.module.ts` — три правки

Правка 1. НАЙДИ строку
`import { HandoverOtpController } from './presentation/pharmacy-terminal/handover-otp.controller.js'`
и ЗАМЕНИ НА:
```ts
import { HandoverOtpController } from './presentation/pharmacy-terminal/handover-otp.controller.js'

// DTJ-307 (EP-12, SLA сборки) — мягкое нарушение SLA: internal-эндпоинт для apps/worker.
import { ReportPickingSlaBreachUseCase } from './application/pharmacy-terminal/report-picking-sla-breach.use-case.js'
import { PickingSlaBreachController } from './presentation/internal/picking-sla-breach.controller.js'
```

Правка 2 (список `controllers`). НАЙДИ:
```ts
    CompletePickingController,
    HandoverOtpController,
  ],
```
ЗАМЕНИ НА:
```ts
    CompletePickingController,
    HandoverOtpController,
    PickingSlaBreachController,
  ],
```

Правка 3 (список `providers`). НАЙДИ:
```ts
    GetHandoverOtpUseCase,
    RegenerateHandoverOtpUseCase,
  ],
```
ЗАМЕНИ НА:
```ts
    GetHandoverOtpUseCase,
    RegenerateHandoverOtpUseCase,
    // DTJ-307 (EP-12, SLA сборки, см. JSDoc импортов выше).
    ReportPickingSlaBreachUseCase,
  ],
```

### 3.7 Каркас спека use case (хелперы — дословно из `accept-order.use-case.spec.ts`)

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import { NotFoundError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import type { OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import type { OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import type { TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import { ReportPickingSlaBreachUseCase } from './report-picking-sla-breach.use-case.js'

const NOW = new Date('2026-09-05T12:07:01.000Z')
const TENANT_ID = 'tenant-1'
const PHARMACY_ID = 'pharmacy-1'

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

class PassthroughUnitOfWork implements OrdersUnitOfWorkPort {
  async run<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    return callback(undefined)
  }
}

function orderAtStatus(status: OrderSnapshot['status']): Order {
  const paymentMethod = status === 'confirmed' ? 'cash_courier' : 'alif_mobi'
  const created = Order.create(validOrderCreateCommand({ tenantId: TENANT_ID, pharmacyId: PHARMACY_ID, paymentMethod }))
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Order.restore({ ...created.value.toSnapshot(), status })
}

function makeHarness(pickupSlaMinutes = 7) {
  const repo = new InMemoryOrderRepository()
  const appendAll = vi.fn<OrdersOutboxPort['appendAll']>().mockResolvedValue(undefined)
  const getPickupSlaMinutes = vi.fn<TenancyFacadePort['getPickupSlaMinutes']>().mockResolvedValue(pickupSlaMinutes)
  const tenancyFacade: TenancyFacadePort = {
    resolveCommissionRate: vi.fn(),
    getCodLimitDiram: vi.fn(),
    getEnabledPaymentMethods: vi.fn(),
    getPickupSlaMinutes,
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
    getHandoverOtpMaxRegenerationsPerOrder: vi.fn(),
    getHandoverOtpRegenerateMinIntervalSeconds: vi.fn(),
  }
  const useCase = new ReportPickingSlaBreachUseCase(repo, new PassthroughUnitOfWork(), { appendAll }, tenancyFacade, new FixedClock())
  return { useCase, repo, appendAll, getPickupSlaMinutes }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// describe/it из раздела 5
```

### 3.8 Каркас спека контроллера (образец — `system-cancel-order.controller.spec.ts`)

```ts
import { describe, expect, it, vi } from 'vitest'
import type {
  ReportPickingSlaBreachResult,
  ReportPickingSlaBreachUseCase,
} from '@/modules/orders/application/pharmacy-terminal/report-picking-sla-breach.use-case.js'
import { PickingSlaBreachController } from './picking-sla-breach.controller.js'

function fakeUseCase(execute: ReturnType<typeof vi.fn>): ReportPickingSlaBreachUseCase {
  return { execute } as unknown as ReportPickingSlaBreachUseCase
}

// describe/it из раздела 5
```

## 4. План — строго по порядку

Шаг 1. Правка union — раздел 3.1. Готово, когда: в файле есть `readonly type: 'SlaBreachedEvent'`.
Шаг 2. Правка реестра — раздел 3.2, обе правки.
Шаг 3. Создать use case — раздел 3.3, текст дословно.
Шаг 4. Создать контроллер — раздел 3.4, текст дословно.
Шаг 5. Правка схемы system-cancel — раздел 3.5.
Шаг 6. Регистрация в `orders.module.ts` — раздел 3.6, три правки.
Шаг 7. Гейт. Ожидаемо: `tsc` и `eslint` зелёные (спеков ещё нет — это нормально).
Шаг 8. Спек use case — раздел 3.7 плюс тесты из раздела 5.
Шаг 9. Спек контроллера — раздел 3.8 плюс тесты из раздела 5. Тест `'processing'` — в `system-cancel-order.controller.spec.ts`.
Шаг 10. Гейт. Нужен `GATE: PASS`.
Шаг 11. Сдача — раздел 8.

## 5. Тесты — что именно должно быть проверено

`report-picking-sla-breach.use-case.spec.ts` (`describe('ReportPickingSlaBreachUseCase (DTJ-307, TC-PHT-021)', …)`):
- `processing` → `appendAll` вызван один раз с `TENANT_ID` и массивом из одного события
  `{ type: 'SlaBreachedEvent', orderId, entityType: 'pharmacy_order', entityId: orderId, breachedAt: NOW, slaMinutes: 7 }`,
  результат `{ orderId, status: 'published' }`.
- `slaMinutes` берётся из `getPickupSlaMinutes(TENANT_ID)`: harness с `10` → в событии `slaMinutes: 10`.
- `picked_up` (сборка успела завершиться) → `appendAll` не вызван, результат `status: 'skipped'`.
- `cancelled` (жёсткий таймер уже отменил) → `skipped`, `appendAll` не вызван.
- `paid_escrow` (заказ ещё не принят) → `skipped`, `appendAll` не вызван.
- заказа нет в репозитории → `rejects.toBeInstanceOf(NotFoundError)`, `appendAll` не вызван.

`picking-sla-breach.controller.spec.ts` (`describe('PickingSlaBreachController (DTJ-307)', …)`):
- `report('order-1', { tenantId: 'tenant-1' })` → `execute` вызван ровно с `{ tenantId: 'tenant-1', orderId: 'order-1' }`,
  ответ `{ data: <результат use case> }`.
- результат `status: 'skipped'` пробрасывается как есть.

`system-cancel-order.controller.spec.ts` — добавить один `it` в существующий `describe`:
- `expectedFromStatus: 'processing'`, `reason: 'pickup_sla_timeout'` → команда use case содержит
  `expectedFromStatus: 'processing'` (так же, как соседний тест с `'pending_payment'`).

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
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1 -Allowed 'apps/api/src/modules/orders/domain/order-domain-event*','apps/api/src/modules/orders/application/pharmacy-terminal/report-picking-sla-breach.use-case*','apps/api/src/modules/orders/presentation/internal/picking-sla-breach.controller*','apps/api/src/modules/orders/presentation/internal/system-cancel-order.controller*','apps/api/src/modules/orders/orders.module.ts' -Commit "feat(orders): DTJ-307a — SlaBreachedEvent и internal-эндпоинт мягкого нарушения SLA сборки"
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

=== КОНЕЦ ЗАДАНИЯ DTJ-307a ===
