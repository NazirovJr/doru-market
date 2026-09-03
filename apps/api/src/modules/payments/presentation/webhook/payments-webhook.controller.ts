/**
 * `PaymentsWebhookController` (EP-10, DTJ-242, `files_owned`, SRS-API-037, SRS-PAY-019) —
 * `POST /api/v1/payments/webhook`. Единственный маршрут (не параметризован по провайдеру в
 * пути) — `X-Payment-Provider` определяет верификатор ВНУТРИ `HandlePaymentWebhookUseCase`.
 *
 * `rawBody` (Buffer, СЫРЫЕ байты тела, ДО JSON.parse — подпись покрывает байты, как они
 * пришли по проводу, SRS-PAY-020 п.1): включён глобально `NestFactory.create(AppModule,
 * adapter, { rawBody: true })` (`main.ts`, правка ЭТОГО тикета — риск, названный DTJ-242
 * буквально: «нужна явная конфигурация rawBody: true в NestFactory.create»). Контроллер сам
 * НЕ парсит `req.body` вовсе — `HandlePaymentWebhookUseCase`/адаптер-верификатор делают
 * `JSON.parse` ТОЛЬКО ПОСЛЕ подтверждения подписи (`verify()`, синхронно).
 *
 * Никаких `@UseGuards` — банк не аутентифицирован JWT/тенантом. `@SkipTenantResolution()`
 * (НАЙДЕННЫЙ дефект инфраструктуры, починен здесь): глобальный `TenantScopeGuard`
 * (`common/guards/tenant-scope.guard.ts`, `APP_GUARD` в `TenancyModule`) применяется КО
 * ВСЕМ маршрутам без исключения и бросает `500`, если `TenantContext.get()` вообще не
 * инициализирован — banковский вебхук не несёт ни `Host`/slug, ни JWT, а
 * `TenantResolutionMiddleware` резолвит его в `unresolved`, чего guard'у уже недостаточно
 * (`@Public()` не помогает — он лишь снимает ВТОРУЮ проверку, первая — «контекст вообще
 * есть» — остаётся). До этого тикета `@SkipTenantResolution()` был явно ограничен
 * инвариантом «ТОЛЬКО health/readiness» (см. её JSDoc) — расширено ЗДЕСЬ вторым легитимным
 * случаем (внешний системный принципал без тенантной идентичности вовсе), а не обойдено
 * `@Public()`/ручным перехватом. Путь ТАКЖЕ добавлен в `TENANT_RESOLUTION_EXCLUDED_PATHS`
 * (`tenant-resolution.middleware.ts`) — незачем резолвить Host/slug для запроса, где
 * результат заведомо не используется. `orderId`/`tenantId` резолвятся строго через
 * `payment_operations.provider_ref → orders.tenant_id` (SRS-API-046-эквивалент для
 * системного принципала). Единственная защита — HMAC-подпись, проверяемая ВНУТРИ use case
 * ДО какой-либо бизнес-логики (SRS-PAY-020).
 *
 * Ошибки — `WebhookProviderUnknownError`/`InvalidWebhookSignatureError` — оба `DomainError`
 * (`@dorutj/contracts`), пробрасываются как есть; `AllExceptionsFilter` (единственный живой
 * фильтр, `common/filters/all-exceptions.filter.ts`) маппит их в `400`/`401` автоматически —
 * контроллер не перехватывает ошибки вручную (`02` §3.2: presentation не знает бизнес-правил).
 */
import { Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { SkipTenantResolution } from '@/common/guards/tenant-scope.guard.js'
import { HandlePaymentWebhookUseCase } from '@/modules/payments/application/use-cases/handle-payment-webhook.use-case.js'

const PROVIDER_HEADER = 'x-payment-provider'

interface WebhookRequest extends FastifyRequest {
  rawBody?: Buffer
}

@Controller({ path: 'payments', version: '1' })
@SkipTenantResolution()
export class PaymentsWebhookController {
  public constructor(@Inject(HandlePaymentWebhookUseCase) private readonly handleWebhook: HandlePaymentWebhookUseCase) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  public async receiveWebhook(@Req() req: WebhookRequest): Promise<{ readonly received: true }> {
    const rawBody = req.rawBody ?? Buffer.alloc(0)
    const rawHeaders = req.headers
    const providerName = normalizeHeaderValue(rawHeaders[PROVIDER_HEADER]) ?? ''
    await this.handleWebhook.execute(rawBody, normalizeHeaders(rawHeaders), providerName)
    return { received: true }
  }
}

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

/** Fastify отдаёт `Record<string, string | string[] | undefined>` — `BankWebhookVerifierPort.verify` ждёт `Record<string,string>` (см. JSDoc порта). */
function normalizeHeaders(rawHeaders: Record<string, string | string[] | undefined>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(rawHeaders)) {
    const single = normalizeHeaderValue(value)
    if (single !== undefined) {
      normalized[key] = single
    }
  }
  return normalized
}
