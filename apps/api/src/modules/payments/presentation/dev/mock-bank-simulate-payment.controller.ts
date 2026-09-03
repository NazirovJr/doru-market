/**
 * `POST /api/v1/dev/mock-bank/simulate-payment` (EP-10, DTJ-238, SRS-PAY-004) — триггерит
 * вручную тот же вебхук, что `MockBankAutoPayJob` шлёт автоматически (delay=0, не таймер),
 * для управляемых Playwright-сценариев (CUJ-2) и тестов, которые проверяют именно
 * `pending_payment` (`MOCK_BANK_AUTO_PAY_DELAY_MS=0`, авто-вебхук выключен).
 *
 * ДВОЙНАЯ ЗАЩИТА (AC3 DTJ-238, буквальное требование тикета «guard + роутинг», DoD «физически
 * недостижим при NODE_ENV=production»): `MockBankDevAccessGuard` (тот же приём, что
 * `ApiDocsAccessGuard`/`common/openapi/openapi.module.ts`, SRS-API-061 — `404`, НЕ `403`,
 * чтобы не раскрывать факт существования маршрута в проде) ПЛЮС повторная явная проверка ВНУТРИ
 * обработчика — не полагаться только на guard/роутинг, ticket требует проверку буквально «в
 * каждом обработчике».
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Post,
  UseGuards,
  type CanActivate,
} from '@nestjs/common'
import { AppConfigService } from '@/config/app-config.service.js'
import { MockBankProvider } from '@/modules/payments/infrastructure/adapters/mock-bank.provider.js'

const MOCK_BANK_DEV_DISABLED_MESSAGE = 'mock-bank dev endpoint is not available'

/** Доступен ТОЛЬКО если `PAYMENT_DRIVER=mock_bank` И `NODE_ENV !== 'production'` (AC3, DoD). */
function isMockBankDevAccessAllowed(config: AppConfigService): boolean {
  return !config.isProduction && config.paymentDriver === 'mock_bank'
}

@Injectable()
class MockBankDevAccessGuard implements CanActivate {
  public constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  public canActivate(): boolean {
    if (!isMockBankDevAccessAllowed(this.config)) {
      throw new NotFoundException(MOCK_BANK_DEV_DISABLED_MESSAGE)
    }
    return true
  }
}

const SIMULATE_OUTCOMES = ['paid', 'failed'] as const
type SimulateOutcome = (typeof SIMULATE_OUTCOMES)[number]

interface SimulatePaymentRequestBody {
  readonly providerRef: string
  readonly outcome: SimulateOutcome
}

function isSimulatePaymentRequestBody(value: unknown): value is SimulatePaymentRequestBody {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.providerRef === 'string' &&
    body.providerRef.length > 0 &&
    typeof body.outcome === 'string' &&
    (SIMULATE_OUTCOMES as readonly string[]).includes(body.outcome)
  )
}

@Controller({ path: 'dev/mock-bank', version: '1' })
@UseGuards(MockBankDevAccessGuard)
export class MockBankSimulatePaymentController {
  public constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(MockBankProvider) private readonly mockBankProvider: MockBankProvider,
  ) {}

  @Post('simulate-payment')
  @HttpCode(HttpStatus.OK)
  public async simulatePayment(@Body() body: unknown): Promise<{ readonly triggered: true }> {
    // Явная повторная проверка ВНУТРИ обработчика (ticket AC3/DoD) — не полагаться
    // ИСКЛЮЧИТЕЛЬНО на `MockBankDevAccessGuard`/роутинг.
    if (!isMockBankDevAccessAllowed(this.config)) {
      throw new NotFoundException(MOCK_BANK_DEV_DISABLED_MESSAGE)
    }
    if (!isSimulatePaymentRequestBody(body)) {
      throw new BadRequestException('body must be { providerRef: string, outcome: "paid" | "failed" }')
    }
    const result = await this.mockBankProvider.simulateWebhook(body.providerRef, body.outcome)
    if (!result.ok) {
      throw new NotFoundException(result.error.message)
    }
    return { triggered: true }
  }
}
