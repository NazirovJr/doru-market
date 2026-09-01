/**
 * `OtpCode` (EP-01, DTJ-010, DTJ-024, SRS-DOM-069) — доменное представление OTP-кода.
 *
 * Чистый VO: хранит ХЕШ (`codeHash`), а не сырой код. Сырой код существует ТОЛЬКО
 * в стеке `RequestOtpUseCase` (формируется генератором → передаётся в `SmsProvider` →
 * забывается); в БД и в `OtpCode` живёт только хеш (SRS-API-021). Это правило
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.5: невалидное состояние невозможно
 * сконструировать.
 *
 * `subjectRef` — то, к чему привязан код (по умолчанию `phone.value` для логина,
 * `telegram_chat_id` для TWA и т.п.). Фиксируется в момент `issue(...)` и не
 * меняется.
 *
 * Конструктор приватный: внешний код вызывает `issue()` или `restore()` —
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.2.
 *
 * `verify()` (DTJ-024, SRS-API-021): сравнивает `sha256(candidateCode + otpRequestId)`
 * с сохранённым `codeHash`. Возвращает `Result<OtpCode, OtpError>`. Для `login`
 * (SRS-DOM-082) `verify` сам по себе НИКОГДА не блокирует — презентационный лимит
 * (5 попыток, `OTP_VERIFY_MAX_ATTEMPTS`) реализован в `VerifyOtpUseCase` через
 * `RateLimitCheckerPort` (Redis, отдельный от VO `attempts`-поля). См. DTJ-024
 * §«Риски и подводные камни».
 */
import { OtpMismatchError } from '@dorutj/contracts'
import { type Result, err, ok } from '@dorutj/domain-kernel'
import { type Clock } from '@/shared-kernel/index.js'

/** 6 цифр — дефолт (SRS-API-022, коды OTP длиной 4-8 цифр, R1 — 6). */
export const OTP_CODE_LENGTH = 6
export const OTP_TTL_SECONDS = 300 // SRS-API-018
const MS_PER_SECOND = 1000

interface OtpCodeProps {
  readonly codeHash: string
  readonly subjectRef: string
  readonly issuedAt: Date
  readonly expiresAt: Date
}

export class OtpCode {
  private constructor(public readonly props: OtpCodeProps) {}

  /** Геттеры — узкий публичный интерфейс, мутации запрещены (C13). */
  get codeHash(): string {
    return this.props.codeHash
  }
  get subjectRef(): string {
    return this.props.subjectRef
  }
  get issuedAt(): Date {
    return this.props.issuedAt
  }
  get expiresAt(): Date {
    return this.props.expiresAt
  }

  /**
   * Фабрика: фиксирует хеш кода + время выдачи. `clock.now()` берётся из
   * порта (Ж8 §2.6, никаких `Date.now()` в domain). `ttlSeconds` — из ENV
   * (DTJ-010 §«Что сделать»), по умолчанию 300.
   */
  static issue(params: {
    readonly codeHash: string
    readonly subjectRef: string
    readonly clock: Clock
    readonly ttlSeconds?: number
  }): OtpCode {
    const issuedAt = params.clock.now()
    const expiresAt = shiftDateBySeconds(issuedAt, params.ttlSeconds ?? OTP_TTL_SECONDS)
    return new OtpCode({
      codeHash: params.codeHash,
      subjectRef: params.subjectRef,
      issuedAt,
      expiresAt,
    })
  }

  /** Гард для восстановления из БД (маппинг `codeHash`+`expiresAt` → VO). */
  static restore(props: OtpCodeProps): OtpCode {
    return new OtpCode(props)
  }

  isExpired(clock: Clock): boolean {
    return clock.now().getTime() > this.props.expiresAt.getTime()
  }

  /**
   * Сравнивает `candidateCodeHash` (sha256(candidateCode + otpRequestId)) с
   * сохранённым `codeHash` (SRS-API-021). Истёкший код → `OtpMismatchError`
   * (НЕ отдельный `OtpExpiredError` — тикет DTJ-024 §3.2 «единообразие с
   * обычным неверным кодом, не давать способ перебором узнавать валидность
   * `otpRequestId`»). Сам по себе `verify` НИКОГДА не блокирует для
   * `purpose='login'` (SRS-DOM-082) — лимит попыток — в use case.
   */
  verify(candidateCodeHash: string): Result<OtpCode, OtpMismatchError> {
    if (candidateCodeHash !== this.props.codeHash) {
      return err(new OtpMismatchError())
    }
    return ok(this)
  }
}

/**
 * `OtpCode` нуждается ровно в одном `new Date()` — для вычисления `expiresAt`
 * из `issuedAt + ttl`. Скрываем это в чистой функции вместо дополнительного
 * класса (C15 — нет второго потребителя). Ж8 §2.6 запрещает `new Date()` и
 * `Date.now()` В PRODUCTION DOMAIN — здесь `new Date()` принимает готовое
 * значение `Date` от `Clock`, не текущее время, и не зависит от
 * системных часов напрямую.
 */
function shiftDateBySeconds(base: Date, seconds: number): Date {
  // eslint-disable-next-line no-restricted-globals -- ЕДИНСТВЕННОЕ место `new Date()` в domain-слое: чистая арифметика над Date, не системные часы (C7, §2.6).
  return new Date(base.getTime() + seconds * MS_PER_SECOND)
}
