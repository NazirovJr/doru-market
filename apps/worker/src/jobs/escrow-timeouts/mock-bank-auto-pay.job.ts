/**
 * `MockBankAutoPayJob` (EP-10, DTJ-238, SRS-PAY-004) — consumer стороны apps/worker очереди
 * `mock-bank-auto-pay`. Producer — `apps/api/src/modules/payments/infrastructure/adapters/
 * mock-bank.provider.ts` (`MockBankProvider.createInvoice()`/`refund()`/`simulateWebhook()`),
 * СВЯЗЬ ТОЛЬКО через имя очереди BullMQ/Redis — apps/worker не может импортировать код apps/api
 * напрямую (отдельные TS-проекты монорепо), `MockBankAutoPayJobData` — СВОЯ копия формы
 * payload, синхронизируемая вручную с `mock-bank.provider.ts` (см. JSDoc там же).
 *
 * Отправляет `POST /api/v1/payments/webhook` этого же логического деплоя (`API_INTERNAL_URL`,
 * `env.schema.ts`) с `X-Payment-Provider: mock_bank` и телом, подписанным ТЕМ ЖЕ HMAC-SHA256
 * секретом (`MOCK_BANK_WEBHOOK_SECRET`), что использует `MockBankWebhookVerifierAdapter`
 * (apps/api) для верификации — гоняет РЕАЛЬНЫЙ код-путь подписи в dev/E2E, не байпас
 * (SRS-PAY-004/005). Тело/заголовок подписи — 1:1 формат, ожидаемый верификатором
 * (`bankEventId`/`providerRef`/`type`/`amountDiram`/`occurredAt`, `x-webhook-signature`,
 * ASSUMPTION имени заголовка — см. JSDoc `mock-bank-webhook-verifier.adapter.ts`).
 *
 * Обработчик `POST /api/v1/payments/webhook` реализуется отдельным тикетом (DTJ-243, «Риски»
 * ticket'а DTJ-238) — до его готовности `fetch` бьёт в реальный маршрут apps/api, который либо
 * ещё не существует (404, лог WARN, не бросает — BullMQ не должен ретраить бесконечно эталонный
 * dev-сценарий отсутствующего эндпоинта), либо уже отвечает, если оба тикета интегрированы.
 */
import { createHmac } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import type { MockBankAutoPayJobData } from './mock-bank-auto-pay.types.js'

const WEBHOOK_PATH = '/api/v1/payments/webhook'
const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature'
const PAYMENT_PROVIDER_HEADER = 'x-payment-provider'
const MOCK_BANK_PROVIDER_NAME = 'mock_bank'
/** 404 — маршрут DTJ-243 ещё не задеплоен (ожидаемо до интеграции обоих тикетов, см. JSDoc файла). */
const EXPECTED_MISSING_ROUTE_STATUS = 404

export interface MockBankAutoPayJobDeps {
  readonly apiInternalUrl: string
  readonly webhookSecret: string | undefined
}

@Injectable()
export class MockBankAutoPayJob {
  private readonly logger = new Logger(MockBankAutoPayJob.name)

  public async process(job: Job<MockBankAutoPayJobData>, deps: MockBankAutoPayJobDeps): Promise<void> {
    if (deps.webhookSecret === undefined) {
      // Программная ошибка конфигурации (PAYMENT_DRIVER=mock_bank без секрета) — бросает, не
      // молчит: тот же принцип, что D-EP09-16 для заглушек денежных операций.
      throw new Error('MOCK_BANK_WEBHOOK_SECRET is not configured — cannot sign outgoing mock-bank webhook')
    }
    const rawBody = this.buildRawBody(job.data)
    const signature = createHmac('sha256', deps.webhookSecret).update(rawBody).digest('hex')

    const response = await fetch(new URL(WEBHOOK_PATH, deps.apiInternalUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [PAYMENT_PROVIDER_HEADER]: MOCK_BANK_PROVIDER_NAME,
        [WEBHOOK_SIGNATURE_HEADER]: signature,
      },
      body: rawBody,
    })

    this.assertAcceptableResponse(response, job.data.providerRef)
  }

  private buildRawBody(data: MockBankAutoPayJobData): string {
    return JSON.stringify({
      bankEventId: data.bankEventId,
      providerRef: data.providerRef,
      type: data.type,
      amountDiram: data.amountDiram,
      occurredAt: new Date().toISOString(),
    })
  }

  private assertAcceptableResponse(response: Response, providerRef: string): void {
    if (response.ok) {
      return
    }
    if (response.status === EXPECTED_MISSING_ROUTE_STATUS) {
      this.logger.warn(
        `mock-bank-auto-pay: POST ${WEBHOOK_PATH} -> 404 для providerRef=${providerRef} — ` +
          'обработчик вебхука (DTJ-243) ещё не задеплоен, см. JSDoc файла.',
      )
      return
    }
    throw new Error(`mock-bank-auto-pay: webhook POST failed for providerRef=${providerRef} (HTTP ${String(response.status)})`)
  }
}
