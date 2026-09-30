> **УСТАРЕЛ (19.09.2026) — не отправлять.** Содержит пять фактических ошибок, одна из них роняет
> каждый `accept` (`jobId` с двоеточием), и предлагает класс `PickupSlaTimeoutJob`, который уже
> занят DTJ-254. Разбор — `reports/qwen3/ANALYSIS-2026-09-19.md` §3. Замена — четыре проверенных
> задания `reports/qwen3/tasks/DTJ-307a.md` … `DTJ-307d.md`.

Ты работаешь разработчиком в монорепозитории DoruTJ (D:\job\doruTJ). Тикет: DTJ-307.

## ШАГ 0 — обязательно прочитать целиком ПЕРЕД любым кодом

1. `tickets/ep08-pharmacy-courier-web/DTJ-307.md` — единственный источник правды по критериям
   приёмки/DoD. НО: три места в тексте тикета расходятся с реальным кодом — см. раздел
   «Расхождения тикета с реальностью» ниже, следуй РЕАЛЬНОМУ коду, не буквальному тексту в этих
   трёх местах.
2. `apps/api/src/modules/orders/application/pharmacy-terminal/propose-partial-fulfillment.use-case.ts`
   — образец «как из use case планировать BullMQ delayed job»: `timeoutQueue.schedule(...)`
   вызывается ПОСЛЕ `unitOfWork.run(...)`, не внутри него (строка ~161 после строки ~123).
3. `apps/api/src/modules/orders/infrastructure/jobs/partial-fulfillment-timeout.processor.ts` —
   образец producer'а (`Queue.add`, `jobId`, `JOB_OPTIONS` с `attempts`/`backoff`/`removeOnComplete`).
   Содержимое ниже — скопируй структуру 1:1, поменяв только имена/константы.
4. `apps/worker/src/jobs/escrow-timeouts/partial-fulfillment-timeout.job.ts` +
   `system-order-cancel.client.ts` — образец consumer'а в `apps/worker` (HTTP-мост к `apps/api`).
5. `apps/api/src/modules/orders/application/order-lifecycle/system-cancel-order.use-case.ts` +
   `apps/api/src/modules/orders/presentation/internal/system-cancel-order.controller.ts` —
   ГОТОВЫЙ, УЖЕ РАБОЧИЙ путь отмены заказа с полным рефандом/эскроу/освобождением резерва.

## ГОТОВЫЕ ФАКТЫ — не переоткрывай, используй

- **`tenant_settings.pickup_sla_minutes`/`pickup_sla_buffer_minutes` УЖЕ существуют** в схеме
  (`apps/api/src/db/schema/tenants.ts`) с дефолтами 7/5. Миграция не нужна. `TenancyFacadePort`
  уже имеет `getPickupSlaMinutes(tenantId)` — тебе нужно добавить ТОЛЬКО
  `getPickupSlaBufferMinutes(tenantId)` по тому же образцу (метод + реализация в
  `TenancyFacadeAdapter`, читает `tenantSettings.pickupSlaBufferMinutes`).
- **`requestSystemOrderCancel` (`apps/worker/src/jobs/escrow-timeouts/system-order-cancel.client.ts`)
  УЖЕ существует, УЖЕ поддерживает `reason: 'pickup_sla_timeout'`** и её JSDoc буквально называет
  твою будущую джобу `PickupSlaTimeoutJob` — назови класс именно так. НЕ пиши новый HTTP-клиент —
  импортируй и вызови существующий `requestSystemOrderCancel`.
- **Жёсткий (hard) обработчик НЕ реализует рефанд/эскроу/отмену сам.** Всё это уже делает
  `SystemCancelOrderUseCase` (вызывается через `requestSystemOrderCancel` → `POST /api/v1/internal/
  orders/:id/system-cancel`). Твоя `PickupSlaTimeoutJob` (в `apps/worker`) — ТОЛЬКО тонкий мост:
  вызвать `requestSystemOrderCancel(deps, { orderId, tenantId, expectedFromStatus: 'processing',
  reason: 'pickup_sla_timeout' })`. Идемпотентность «заказ уже не processing» уже реализована
  ВНУТРИ `SystemCancelOrderUseCase` (`expectedFromStatus` mismatch → `status: 'skipped'`, не
  ошибка) — не проверяй статус дважды.
- **`OrderCancelledEvent` уже публикуется автоматически** при вызове `order.cancel()` внутри
  `SystemCancelOrderUseCase` — отдельного «`OrderAutoCancelledEvent`» заводить не нужно (см.
  «Расхождения» ниже).
- **`OtpCodesRepository`/`system-cancel`-путь НЕ трогай** — не связаны с этим тикетом.

## НЕОБХОДИМОЕ РАСШИРЕНИЕ (нужно для работы, но не в буквальном `files_owned`) — три места

1. **`SystemCancelExpectedStatus`** (`apps/worker/.../system-order-cancel.client.ts`) — сейчас
   `'pending_payment' | 'paid_escrow' | 'confirmed'`, НЕ включает `'processing'`. Добавь
   `'processing'` в этот union (одна строка).
2. **`SystemCancelOrderRequestSchema`** (`apps/api/.../system-cancel-order.controller.ts`) — Zod
   `z.enum(['pending_payment', 'paid_escrow', 'confirmed'])`, тоже НЕ включает `'processing'`.
   Добавь `'processing'` туда же (одна строка, `z.enum([...])`).
   `SystemCancelOrderCommand.expectedFromStatus` в самом use case уже типизирован широким
   `OrderStatus` — этот файл менять не нужно.
3. **Новый внутренний путь для МЯГКОГО (soft) обработчика.** В отличие от жёсткого, мягкий
   обработчик НЕ отменяет заказ — только (если заказ всё ещё `processing`) публикует
   `SlaBreachedEvent` через `OrdersOutboxPort` (обычный доменный event, ТОТ ЖЕ механизм, что
   `OrderConfirmedEvent`/`OrderPickedUpEvent` — добавь новый вариант в union `OrderDomainEvent`
   в `apps/api/src/modules/orders/domain/order-domain-event.ts`, поля минимум `{orderId, at}`).
   `apps/worker` не может писать в БД/outbox напрямую (другой процесс) — нужен новый internal
   endpoint, симметричный `system-cancel`: `POST /api/v1/internal/orders/:id/sla-soft-breach`
   (`InternalServiceGuard`, тот же приём, что `SystemCancelOrderController`) → маленький use case
   (`ReportSlaSoftBreachUseCase` или похожее имя), который: находит заказ, если `status ===
   'processing'` — публикует `SlaBreachedEvent` через `unitOfWork.run(tx => outbox.appendAll(...))`
   (даже без изменения самого заказа — транзакция нужна просто чтобы дать `appendAll` валидный
   `tx`, `OrdersOutboxPort.appendAll` всегда требует `tx`), иначе — no-op (заказ уже прогрессировал,
   ничего не делать, НЕ ошибка). Джоба `apps/worker`-стороны (`PickupSlaSoftBreachJob` или похожее
   имя) — тот же тонкий HTTP-мост, что `PickupSlaTimeoutJob`, свой отдельный `fetch` ИЛИ (лучше)
   общая мини-функция рядом с `requestSystemOrderCancel` в том же файле `system-order-cancel.client.ts`
   (посмотри, насколько легко расширить существующий файл, прежде чем заводить новый).

## РАСХОЖДЕНИЯ ТЕКСТА ТИКЕТА С РЕАЛЬНЫМ КОДОМ — следуй коду, не тексту

1. Тикет пишет `order.cancel('pickup_sla_exceeded', system)` — такой причины НЕТ в
   `ORDER_CANCEL_REASON_VALUES` (`order-domain-event.ts`). Реальное значение —
   **`'pickup_sla_timeout'`** (уже есть в enum и уже принимается
   `SystemCancelOrderController`/`requestSystemOrderCancel`). Используй его.
2. Тикет говорит «публикует `OrderAutoCancelledEvent` (существующее событие)» — такого события
   НЕТ в `OrderDomainEvent`. Реально публикуется `OrderCancelledEvent` (уже существует,
   происходит автоматически внутри `order.cancel()`) — ничего дополнительно публиковать не нужно.
3. Тикет говорит «WS `ops.sla_breached` в комнату `platform:ops` (существующий маршрут)» — этого
   маршрута/WS-шлюза (`RealtimeGateway`) в кодовой базе ЕЩЁ НЕТ (заведёт отдельный тикет DTJ-308,
   не сделан на момент этого тикета). Публикуй `SlaBreachedEvent` через `OrdersOutboxPort` (см.
   выше) — когда DTJ-308 подключит WS-consumer к outbox-событиям, эта публикация заработает как
   WS без правок этого тикета. Не пытайся сам писать WS-код — его не к чему подключать сегодня.

## Планирование двух джобов — `ScheduleSlaWatchdogUseCase`

Вызывается из `AcceptOrderUseCase.execute()` (`apps/api/src/modules/orders/application/
pharmacy-terminal/accept-order.use-case.ts`) **после** его `unitOfWork.run(...)` (тот же порядок,
что `propose-partial-fulfillment` → `timeoutQueue.schedule`), сразу после успешного
`startProcessing()`. Это модификация ЧУЖОГО файла (DTJ-301) — трогай ТОЛЬКО добавлением одного
вызова, не переписывай остальное. Два вызова `SlaWatchdogQueuePort.schedule(...)` (новый порт,
1:1 копия `PartialFulfillmentTimeoutQueuePort` по структуре):
- мягкий: `jobId = 'soft:' + orderId`, `delay = pickupSlaMinutes` минут.
- жёсткий: `jobId = 'hard:' + orderId`, `delay = pickupSlaMinutes + pickupSlaBufferMinutes` минут.

`SlaWatchdogProcessor` (`infrastructure/jobs/sla-watchdog.processor.ts`, files_owned) — ОДИН
файл-producer с ДВУМЯ `queue.add()` вызовами (можно один `Queue`, два разных `jobId`/`delay`) —
1:1 копия структуры `PartialFulfillmentTimeoutProcessor`.

## ЖЁСТКИЕ ПРАВИЛА ПРОЕКТА (нарушение — тикет не сдан)

1. Стек: NestJS 11 на **Fastify** (НЕ Express), **Vitest** (НЕ Jest) везде, Drizzle ORM. Тесты —
   `import { describe, it, expect, vi } from 'vitest'`.
2. `apps/api` и `apps/worker` — РАЗНЫЕ процессы. `apps/worker` НИКОГДА не импортирует
   `@/modules/...` из `apps/api` — только HTTP через `fetch` (см. `system-order-cancel.client.ts`
   как образец: `API_INTERNAL_URL_TOKEN`/`INTERNAL_API_KEY_TOKEN`, заголовок
   `x-internal-api-key`, НЕ заводи вторую пару токенов — переиспользуй эти же).
3. Перед ЛЮБЫМ импортом — grep по репозиторию, что реально существует. Перед созданием нового
   файла/типа/порта — grep по имени, нет ли уже такого же по смыслу.
4. Расширяешь интерфейс/порт (`TenancyFacadePort`) — находишь ВСЕ реализации (production-адаптер
   И тестовые моки/фикстуры, `grep "TenancyFacadePort = {" --include=*.spec.ts`) и обновляешь
   КАЖДУЮ, иначе сломаешь чужие, ранее рабочие тесты.
5. Не отключай/не комментируй бизнес-правило, если не можешь его правильно реализовать. Если
   что-то структурно недостижимо — `throw` с объяснением, не тихий `return`/no-op под видом
   рабочего кода.
6. `import type` — ТОЛЬКО для символов, которые используются исключительно как типы. Если символ
   потом вызывается как функция/декоратор/конструктор (`new X()`, `@X()`) — обычный `import`, не
   `import type`.
7. Идемпотентность — существующий `@Idempotent()` декоратор (`@/common/http/decorators/
   idempotent.decorator.js`) для HTTP-эндпоинтов, если понадобится. Не изобретай `IdempotencyGuard`.
8. Актор в контроллере — `@CurrentUser() claims: JwtClaims` (барабан `@/modules/auth/index.js`),
   не `@Req() req: Request`/`req.actor!`.
9. Ноль файлов-конспектов (`README.md`, `IMPLEMENTATION_SUMMARY.md`) вне `files_owned`.
10. Ветка `feat/dtj-307-sla-watchdog` от `development`, коммиты на русском, БЕЗ Co-Authored-By/
    следов ИИ-авторства. Не мержить самой, не пушить в `development`.

## ОБЯЗАТЕЛЬНАЯ ПРОВЕРКА ПЕРЕД СДАЧЕЙ

Перед проверкой ОБЯЗАТЕЛЬНО удали кэш — иначе `tsc`/turbo может соврать про «всё зелено»:
```
find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete
```
Потом выполни и вставь в отчёт БУКВАЛЬНЫЙ вывод (не пересказ):
```
pnpm --filter @dorutj/api exec tsc --noEmit -p tsconfig.json
pnpm --filter @dorutj/worker exec tsc --noEmit -p tsconfig.json
pnpm lint
pnpm arch:check
pnpm test:arch
pnpm --filter @dorutj/api test
pnpm --filter @dorutj/worker test
pnpm build
```
Единственное заранее известное и допустимое красное — порог покрытия `apps/worker` по функциям
(предсуществующий, не твой периметр, если ты не трогаешь его существующие файлы). Всё остальное
красное — почини у себя, не описывай как «особенность».

## ФОРМАТ ОТЧЁТА

ticketId, branch, коммиты (хэш + сообщение), буквальный вывод каждой команды проверки выше,
список закрытых критериев приёмки (какой файл/тест каждый закрывает — TC-PHT-021/022 из тикета),
явный список любых допущений/отклонений от буквального текста тикета (включая три расхождения
выше, если применимы, и любые новые, которые сам найдёшь).
