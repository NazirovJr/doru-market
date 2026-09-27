/**
 * `MockSmsProviderAdapter` (EP-01, DTJ-023) — dev-реализация `SmsProviderPort`.
 *
 * Поведение (Charter §2.7 — работает без внешнего API-ключа; безопасно в проде):
 *   - `NODE_ENV === 'production'`: НЕ логирует сырой код, маскирует хвост (`**34`).
 *   - иначе: логирует код, если `MOCK_SMS_EXPOSE_CODE_IN_RESPONSE=true` (для
 *     Playwright-E2E), иначе — маскированный хвост.
 *
 * `peekLast()` отдаёт ПОСЛЕДНЮЮ запись отправки — для дев-диагностики и unit-тестов.
 * Наружу — только `GET /_test/last-otp` при E2E_TEST_ENDPOINTS=true (запрещён в production); контроллер
 * `POST /auth/otp/request` ВСЕГДА возвращает одинаковый ответ независимо от среды
 * (SRS-API-018).
 */
import { Inject, Injectable } from '@nestjs/common'
import { AppConfigService } from '@/config/app-config.service.js'
// Внутренние импорты — ПРЯМО из файла (D-27: barrel — только для межмодульного).
import { SMS_PROVIDER, type SmsProviderPort } from '@/modules/auth/application/ports/sms-provider.port.js'
import { type OtpPurpose } from '@/modules/auth/application/ports/otp-generator.port.js'
import { type PhoneNumber } from '@/modules/auth/domain/value-objects/phone-number.vo.js'

interface SmsRecord {
  readonly phone: string
  readonly code: string
  readonly purpose: OtpPurpose
  readonly sentAt: Date
}

@Injectable()
export class MockSmsProviderAdapter implements SmsProviderPort {
  /** Последняя отправка — для тестов/dev-диагностики. НЕ персистируется. */
  private lastSent: SmsRecord | null = null
  private readonly lastByPhone = new Map<string, SmsRecord>()

  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `HealthController`.
  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  /**
   * Возвращает последнюю запись отправки (для unit-тестов use case и dev-диагностики).
   * В HTTP выставлен только `GET /_test/last-otp` под флагом E2E_TEST_ENDPOINTS (не в проде); `POST /auth/otp/request` ВСЕГДА
   * возвращает одинаковый ответ (SRS-API-018, защита от перебора существующих номеров).
   */
  peekLast(): SmsRecord | null {
    return this.lastSent
  }

  // Параллельные E2E-сценарии логинят разные номера — «последняя вообще» им не подходит.
  peekLastFor(phone: string): SmsRecord | null {
    return this.lastByPhone.get(phone) ?? null
  }

  sendOtp(phone: PhoneNumber, code: string, purpose: OtpPurpose): Promise<void> {
    const sentAt = new Date()
    this.lastSent = { phone: phone.value, code, purpose, sentAt }
    this.lastByPhone.set(phone.value, this.lastSent)
    if (this.config.isProduction) {
      // НЕ логируем сырой код в проде (SRS-API-021).
      return Promise.resolve()
    }
    if (this.config.mockSmsExposeCodeInResponse) {
      process.stdout.write(
        `[mock-sms] phone=${phone.value} purpose=${purpose} code=${code} sentAt=${sentAt.toISOString()}\n`,
      )
    } else {
      process.stdout.write(
        `[mock-sms] phone=${phone.value} purpose=${purpose} codeMasked=**${maskTail(code)} sentAt=${sentAt.toISOString()}\n`,
      )
    }
    return Promise.resolve()
  }
}

function maskTail(code: string): string {
  const MIN_LENGTH_FOR_MASK = 2
  const TAIL_LENGTH = 2
  if (code.length <= MIN_LENGTH_FOR_MASK) return '**'
  return code.slice(-TAIL_LENGTH)
}

export { SMS_PROVIDER }
