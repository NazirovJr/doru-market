/**
 * `OtpCodesRepository` (EP-01, DTJ-015, DTJ-023, DTJ-024) — порт для ХЕШЕЙ OTP-кодов.
 *
 * Контракт:
 *   - `create(input)` — записать хеш + TTL + `subjectRef` + `purpose`. `input.id`
 *     ЗАДАЁТ ключ строки (не генерируется репозиторием): `RequestOtpUseCase`
 *     обязан знать `id` ДО вызова `create`, потому что тот же `id` (= `otpRequestId`,
 *     возвращаемый клиенту) используется КАК СОЛЬ при хешировании кода — сначала
 *     генерируется `id`, потом `codeHash = sha256(code + id)`, и только затем
 *     запись создаётся С ЭТИМ `id`. Если реализация проигнорирует `input.id` и
 *     присвоит собственный (как было до фикса Ж13 при разблокировке волны 4) —
 *     `VerifyOtpUseCase.findByIdForUpdate(otpRequestId)` никогда не найдёт строку,
 *     и ЛЮБОЙ verify (даже с правильным кодом) вернёт `OtpMismatchError` — этот
 *     дефект ни разу не проявлялся в unit-тестах use case'ов (они мокали
 *     репозиторий и не проверяли round-trip request→verify), только в
 *     integration-тестах через реальный HTTP.
 *   - `findByIdForUpdate(tx, id)` (DTJ-024, SRS-API-071) — найти строку по
 *     `otpRequestId` С ПЕССИМИСТИЧНОЙ БЛОКИРОВКОЙ (`SELECT ... FOR UPDATE`).
 *     `tx` — транзакционный Drizzle-клиент (из `UnitOfWorkPort.run`).
 *     InMemory-реализация: `Map.get` (атомарно для однопоточного Node.js).
 *   - `markConsumed(tx, id, now)` (DTJ-024) — пометить строку потреблённой.
 *     Должен вызываться в той же транзакции, что `findByIdForUpdate`.
 *   - `incrementAttempts(tx, id)` (DTJ-024, SRS-DOM-082) — увеличить
 *     `attempts` (доменное поле VO) на 1. НЕ используется для блокировки
 *     `login`-кода (для login блокировка — презентационная через Redis, см.
 *     `VerifyOtpUseCase`); используется для аудита и консистентности.
 *   - `findActiveBySubject(input)` — последний НЕпотреблённый (`consumedAt IS NULL`)
 *     и НЕистёкший код для `subjectRef + purpose` (для будущих сценариев).
 *
 * R1: InMemory-реализация достаточна (DB недоступна в песочнице, см.
 * STATE-AND-RESUME §5.1). Drizzle-реализация появится, когда БД подключится —
 * `tx`-параметр уже в контракте.
 */
import { type UnitOfWorkTx } from './unit-of-work.port.js'

export const OTP_CODES_REPOSITORY = Symbol.for('@dorutj/auth/otp-codes-repository')

export interface OtpCodeRecord {
  readonly id: string
  readonly tenantId: string
  readonly subjectRef: string
  readonly purpose: 'login' | 'onboarding_contact'
  readonly codeHash: string
  readonly attempts: number
  readonly issuedAt: Date
  readonly expiresAt: Date
  readonly consumedAt: Date | null
}

export interface CreateOtpCodeInput {
  /** См. JSDoc `create` выше — id генерируется ВЫЗЫВАЮЩИМ (use case), не репозиторием. */
  readonly id: string
  readonly tenantId: string
  readonly subjectRef: string
  readonly purpose: 'login' | 'onboarding_contact'
  readonly codeHash: string
  readonly issuedAt: Date
  readonly expiresAt: Date
}

export interface OtpCodesRepository {
  create(input: CreateOtpCodeInput): Promise<OtpCodeRecord>
  findByIdForUpdate(tx: UnitOfWorkTx, id: string): Promise<OtpCodeRecord | null>
  markConsumed(tx: UnitOfWorkTx, id: string, now: Date): Promise<void>
  incrementAttempts(tx: UnitOfWorkTx, id: string): Promise<void>
  findActiveBySubject(input: {
    readonly tenantId: string
    readonly subjectRef: string
    readonly purpose: 'login' | 'onboarding_contact'
    readonly now: Date
  }): Promise<OtpCodeRecord | null>
}
