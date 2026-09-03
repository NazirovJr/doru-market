/**
 * `MockBankProvider` (EP-10, DTJ-238, `21-module-orders-payments-escrow.md` §3.2, SRS-PAY-004)
 * — реализация `PaymentProvider` (DTJ-237). НЕ заглушка «для галочки»: единственный провайдер,
 * реально работающий в R1-проде (Charter DoD п.7 «продукт работает без единого внешнего
 * API-ключа») — детерминированный, без сети наружу.
 *
 * Идемпотентность (SRS-PAY-003): `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING
 * RETURNING` ПЕРЕД тем, как «вызвать провайдера» — здесь провайдер И ЕСТЬ локальная операция,
 * но паттерн соблюдён буквально: повторный вызов с тем же ключом не создаёт вторую запись
 * `payment_operations`, возвращает СУЩЕСТВУЮЩИЙ `providerRef` (обнаружено по конфликту).
 *
 * Авто-вебхук (SRS-PAY-004): `createInvoice()`/`refund()` планируют BullMQ delayed job на
 * очередь `mock-bank-auto-pay` (`MOCK_BANK_AUTO_PAY_QUEUE`, задержка = `AppConfigService.
 * mockBankAutoPayDelayMs`) — ЕДИНСТВЕННЫЙ producer; consumer — `MockBankAutoPayJob`
 * (`apps/worker/src/jobs/escrow-timeouts/mock-bank-auto-pay.job.ts`, ДРУГОЙ процесс/деплой,
 * связь ТОЛЬКО через имя очереди BullMQ+Redis — apps/api не может импортировать код apps/worker
 * напрямую, отдельные TS-проекты). `MOCK_BANK_AUTO_PAY_DELAY_MS=0` — джоба НЕ планируется
 * вовсе (`queue.add` не вызывается), заказ остаётся `pending_payment` до dev-эндпоинта
 * (`mock-bank-simulate-payment.controller.ts`).
 */
import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { eq } from 'drizzle-orm'
import type { Provider } from '@nestjs/common'
import type { Result } from '@dorutj/domain-kernel'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import { AppConfigService } from '@/config/app-config.service.js'
import { paymentOperations } from '@/db/schema/payments.js'
import {
  type CreateInvoiceCommand,
  type InvoiceRef,
  type PaymentProvider,
  type PaymentProviderCapabilities,
  type PaymentStatusSnapshot,
  type RefundRef,
} from '@/modules/payments/application/ports/payment-provider.port.js'
import { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'
import { NotSupportedByProviderError } from '@/modules/payments/domain/errors/not-supported-by-provider.error.js'

/** Имя очереди BullMQ — ЕДИНСТВЕННЫЙ канал связи api(producer) → worker(consumer), см. JSDoc файла. */
export const MOCK_BANK_AUTO_PAY_QUEUE_NAME = 'mock-bank-auto-pay'

/** DI-токен для `Queue<MockBankAutoPayJobData>` (провайдер — `payments.module.ts`). */
export const MOCK_BANK_AUTO_PAY_QUEUE = Symbol.for('@dorutj/payments/mock-bank-auto-pay-queue')

const MOCK_BANK_PROVIDER_NAME = 'mock_bank' as const
const MOCK_BANK_MAX_INVOICE_VALIDITY_MINUTES = 15
const MOCK_BANK_INVOICE_REF_PREFIX = 'mock_inv_'
const MOCK_BANK_REFUND_REF_PREFIX = 'mock_refund_'
/** Разделитель `providerRef`/`type` в `jobId` BullMQ — см. JSDoc `enqueueWebhookJob` (найденный дефект: `:` отвергается реальным BullMQ). */
const MOCK_BANK_JOB_ID_SEPARATOR = '__'
const MINUTES_TO_MS = 60_000
/** Тот же профиль, что `BullmqInventorySyncQueueAdapter` (EP-05, DTJ-153). */
const MOCK_BANK_AUTO_PAY_JOB_ATTEMPTS = 5
const MOCK_BANK_AUTO_PAY_BACKOFF_DELAY_MS = 5_000

/**
 * Payload delayed-джобы `mock-bank-auto-pay` (worker consumer:
 * `apps/worker/src/jobs/escrow-timeouts/mock-bank-auto-pay.job.ts`, СВОЯ КОПИЯ этого типа —
 * apps/worker не может импортировать apps/api, границы отдельных TS-проектов монорепо;
 * изменение формы здесь ОБЯЗАНО быть отражено там же вручную). `amountDiram` — `string`
 * (сериализация `bigint` через BullMQ/Redis JSON, не нативный тип).
 */
export interface MockBankAutoPayJobData {
  readonly bankEventId: string
  readonly providerRef: string
  readonly type: 'payment_confirmed' | 'payment_failed' | 'refund_confirmed' | 'refund_failed'
  readonly amountDiram: string
}

@Injectable()
export class MockBankProvider implements PaymentProvider {
  public constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(MOCK_BANK_AUTO_PAY_QUEUE) private readonly autoPayQueue: Queue<MockBankAutoPayJobData>,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  public capabilities(): PaymentProviderCapabilities {
    return {
      providerName: MOCK_BANK_PROVIDER_NAME,
      // Намеренно реалистичные (не оптимистичные) ограничения Alif/DC — SRS-PAY-004.
      supportsHoldCapture: false,
      supportsPartialRefund: false,
      maxInvoiceValidityMinutes: MOCK_BANK_MAX_INVOICE_VALIDITY_MINUTES,
    }
  }

  public async createInvoice(cmd: CreateInvoiceCommand): Promise<Result<InvoiceRef, PaymentProviderError>> {
    const providerRef = await this.insertOrReuseOperation(cmd)
    const qrPayload = `mock://pay/${providerRef}`
    const expiresAt = new Date(Date.now() + MOCK_BANK_MAX_INVOICE_VALIDITY_MINUTES * MINUTES_TO_MS)

    await this.scheduleAutoWebhook(providerRef, 'payment_confirmed', cmd.amountDiram)

    return { ok: true, value: { providerRef, qrPayload, expiresAt } }
  }

  public async getStatus(providerRef: string): Promise<Result<PaymentStatusSnapshot, PaymentProviderError>> {
    const rows = await this.db
      .select()
      .from(paymentOperations)
      .where(eq(paymentOperations.providerRef, providerRef))
      .limit(1)
    const row = rows[0]
    if (row === undefined) {
      return { ok: false, error: new PaymentProviderError('PROVIDER_REF_NOT_FOUND', `Unknown providerRef: ${providerRef}`) }
    }
    return {
      ok: true,
      value: {
        providerRef,
        status: this.toStatusSnapshotStatus(row.status),
        amountDiram: row.amountDiram,
        paidAt: row.status === 'succeeded' ? row.updatedAt : null,
      },
    }
  }

  public async refund(providerRef: string, idempotencyKey: string): Promise<Result<RefundRef, PaymentProviderError>> {
    const original = await this.findOriginalInvoice(providerRef)
    if (original === undefined) {
      return { ok: false, error: new PaymentProviderError('PROVIDER_REF_NOT_FOUND', `Unknown providerRef: ${providerRef}`) }
    }

    const refundProviderRef = await this.insertRefundOperation(original, idempotencyKey)
    await this.scheduleAutoWebhook(refundProviderRef, 'refund_confirmed', original.amountDiram)

    // SRS-PAY-004: refund() — синхронно успешен (мок не эмулирует банковскую задержку самого
    // рефанда, только доставку подтверждающего вебхука через ту же delayed-джобу).
    return {
      ok: true,
      value: { providerRefundRef: refundProviderRef, amountDiram: original.amountDiram, status: 'succeeded' },
    }
  }

  public partialRefund(
    _providerRef: string,
    _amountDiram: bigint,
    _idempotencyKey: string,
  ): Promise<Result<RefundRef, PaymentProviderError>> {
    // capabilities().supportsPartialRefund === false — синхронная проверка контракта
    // (JSDoc `PaymentProvider.partialRefund`), без сети/БД. `capturePreauth`/`voidPreauth`
    // НЕ реализованы (интерфейс делает их опциональными ИМЕННО для этого случая, JSDoc порта):
    // `supportsHoldCapture === false`, вызывающий код обязан проверять `capabilities()` до
    // вызова — вне периметра «Что сделать» DTJ-238 (ticket явно перечисляет только
    // capabilities/createInvoice/refund/partialRefund).
    return Promise.resolve({ ok: false, error: new NotSupportedByProviderError('partialRefund', MOCK_BANK_PROVIDER_NAME) })
  }

  private async insertOrReuseOperation(cmd: CreateInvoiceCommand): Promise<string> {
    const providerRef = `${MOCK_BANK_INVOICE_REF_PREFIX}${randomUUID()}`
    const inserted = await this.db
      .insert(paymentOperations)
      .values({
        orderId: cmd.orderId,
        operationType: 'create_bill',
        idempotencyKey: cmd.idempotencyKey,
        provider: MOCK_BANK_PROVIDER_NAME,
        providerRef,
        status: 'pending',
        amountDiram: cmd.amountDiram,
      })
      .onConflictDoNothing({ target: paymentOperations.idempotencyKey })
      .returning({ providerRef: paymentOperations.providerRef })
    const insertedRef = inserted[0]?.providerRef
    if (insertedRef !== undefined && insertedRef !== null) {
      return insertedRef
    }
    // Конфликт (SRS-PAY-003) — тот же idempotencyKey уже обработан ранее, возвращаем
    // СУЩЕСТВУЮЩИЙ providerRef, НЕ создаём вторую запись/вторую задержанную джобу.
    const existing = await this.db
      .select({ providerRef: paymentOperations.providerRef })
      .from(paymentOperations)
      .where(eq(paymentOperations.idempotencyKey, cmd.idempotencyKey))
      .limit(1)
    const existingRef = existing[0]?.providerRef
    if (existingRef === undefined || existingRef === null) {
      throw new PaymentProviderError('IDEMPOTENCY_RACE', 'payment_operations row vanished after conflict — concurrent delete?')
    }
    return existingRef
  }

  private async findOriginalInvoice(
    providerRef: string,
  ): Promise<{ readonly orderId: string; readonly amountDiram: bigint } | undefined> {
    const rows = await this.db
      .select({ orderId: paymentOperations.orderId, amountDiram: paymentOperations.amountDiram })
      .from(paymentOperations)
      .where(eq(paymentOperations.providerRef, providerRef))
      .limit(1)
    return rows[0]
  }

  private async insertRefundOperation(
    original: { readonly orderId: string; readonly amountDiram: bigint },
    idempotencyKey: string,
  ): Promise<string> {
    const refundProviderRef = `${MOCK_BANK_REFUND_REF_PREFIX}${randomUUID()}`
    const inserted = await this.db
      .insert(paymentOperations)
      .values({
        orderId: original.orderId,
        operationType: 'refund',
        idempotencyKey,
        provider: MOCK_BANK_PROVIDER_NAME,
        providerRef: refundProviderRef,
        status: 'succeeded',
        amountDiram: original.amountDiram,
      })
      .onConflictDoNothing({ target: paymentOperations.idempotencyKey })
      .returning({ providerRef: paymentOperations.providerRef })
    const insertedRef = inserted[0]?.providerRef
    if (insertedRef !== undefined && insertedRef !== null) {
      return insertedRef
    }
    const existing = await this.db
      .select({ providerRef: paymentOperations.providerRef })
      .from(paymentOperations)
      .where(eq(paymentOperations.idempotencyKey, idempotencyKey))
      .limit(1)
    return existing[0]?.providerRef ?? refundProviderRef
  }

  /**
   * `createInvoice()`/`refund()` — авто-вебхук ГЕЙТУЕТСЯ `mockBankAutoPayDelayMs > 0` (AC2
   * DTJ-238: `=0` — джоба НЕ планируется вовсе, заказ остаётся `pending_payment`). Дев-эндпоинт
   * (`simulateWebhook`) обходит этот гейт намеренно — ручной триггер обязан сработать
   * НЕЗАВИСИМО от настроенной задержки авто-оплаты, с `delayMs=0` (немедленно).
   */
  private async scheduleAutoWebhook(providerRef: string, type: MockBankAutoPayJobData['type'], amountDiram: bigint): Promise<void> {
    if (this.config.mockBankAutoPayDelayMs <= 0) {
      return
    }
    await this.enqueueWebhookJob({ providerRef, type, amountDiram, delayMs: this.config.mockBankAutoPayDelayMs })
  }

  private async enqueueWebhookJob(cmd: {
    readonly providerRef: string
    readonly type: MockBankAutoPayJobData['type']
    readonly amountDiram: bigint
    readonly delayMs: number
  }): Promise<void> {
    const jobData: MockBankAutoPayJobData = {
      bankEventId: `mock_evt_${randomUUID()}`,
      providerRef: cmd.providerRef,
      type: cmd.type,
      amountDiram: cmd.amountDiram.toString(),
    }
    await this.autoPayQueue.add(MOCK_BANK_AUTO_PAY_QUEUE_NAME, jobData, {
      delay: cmd.delayMs,
      // Идемпотентность на уровне BullMQ (defense-in-depth поверх payment_operations UNIQUE):
      // повторный createInvoice/refund с тем же providerRef+type не планирует вторую джобу.
      //
      // НАЙДЕННЫЙ ДЕФЕКТ (обнаружен при работе рядом исполнителем DTJ-241, не в его периметре;
      // починено здесь): `:` в `jobId` — реальный BullMQ отвергает такой id целиком
      // (`node_modules/bullmq/dist/cjs/classes/job.js`: `throw new Error('Custom Id cannot
      // contain :')`), т.е. КАЖДЫЙ `createInvoice()`/`refund()` с ненулевым
      // `MOCK_BANK_AUTO_PAY_DELAY_MS` против настоящего Redis падал целиком — не вебхук, а
      // весь `createInvoice()`, то есть любой безналичный checkout. Замаскировано в старом
      // `mock-bank.provider.integration.spec.ts` тем, что там `Queue` была заглушкой
      // (`{ add: vi.fn() }`), не реальным BullMQ — заглушка принимала то, что реальная
      // библиотека отвергает. `MOCK_BANK_JOB_ID_SEPARATOR` — `__`, НЕ `:`/`-`: `providerRef`
      // (`mock_inv_<uuid>`/`mock_refund_<uuid>`) и `type` (`payment_confirmed` и т.п.) сами
      // несут одиночные `_`/`-`, двойное подчёркивание визуально и структурно не встречается
      // ни в одном из них — граница между двумя составляющими id остаётся однозначной.
      jobId: `${cmd.providerRef}${MOCK_BANK_JOB_ID_SEPARATOR}${cmd.type}`,
      // Тот же профиль ретраев, что `BullmqInventorySyncQueueAdapter` (EP-05, DTJ-153) —
      // `apps/api` не открывает исходящих сетевых вызовов сама, но временная недоступность
      // apps/worker/Redis не должна терять вебхук молча.
      attempts: MOCK_BANK_AUTO_PAY_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: MOCK_BANK_AUTO_PAY_BACKOFF_DELAY_MS },
    })
  }

  /**
   * Дев-эндпоинт (`mock-bank-simulate-payment.controller.ts`, DTJ-238 п.4) — ручной триггер
   * того же вебхука, для управляемых Playwright-сценариев. `outcome` — грубый пользовательский
   * словарь ('paid'/'failed'), маппится на `VerifiedWebhookPayload.type`
   * ('payment_confirmed'/'payment_failed'). Контроллер сам отвечает за гейт `PAYMENT_DRIVER`/
   * `NODE_ENV` — этот метод не проверяет их повторно (единая ответственность).
   */
  public async simulateWebhook(providerRef: string, outcome: 'paid' | 'failed'): Promise<Result<void, PaymentProviderError>> {
    const original = await this.findOriginalInvoice(providerRef)
    if (original === undefined) {
      return { ok: false, error: new PaymentProviderError('PROVIDER_REF_NOT_FOUND', `Unknown providerRef: ${providerRef}`) }
    }
    const type = outcome === 'paid' ? 'payment_confirmed' : 'payment_failed'
    await this.enqueueWebhookJob({ providerRef, type, amountDiram: original.amountDiram, delayMs: 0 })
    return { ok: true, value: undefined }
  }

  private toStatusSnapshotStatus(status: 'pending' | 'succeeded' | 'failed'): PaymentStatusSnapshot['status'] {
    if (status === 'succeeded') return 'paid'
    return status
  }
}

/** Nest DI-провайдер очереди `mock-bank-auto-pay` — регистрируется в `payments.module.ts`. */
export const MOCK_BANK_AUTO_PAY_QUEUE_PROVIDER: Provider = {
  provide: MOCK_BANK_AUTO_PAY_QUEUE,
  useFactory: (redis: Redis): Queue<MockBankAutoPayJobData> =>
    new Queue<MockBankAutoPayJobData>(MOCK_BANK_AUTO_PAY_QUEUE_NAME, { connection: redis }),
  inject: [REDIS_CLIENT],
}
