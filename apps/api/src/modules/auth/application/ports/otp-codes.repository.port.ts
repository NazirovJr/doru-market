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
 *   - `findById(id)` (ДОБАВЛЕНО DTJ-306, EP-12 §A.5) — простое НЕблокирующее чтение по
 *     `id` (= `orders.handover_otp_id`), без `tx`. `GetHandoverOtpUseCase` только
 *     отображает код фармацевту — держать транзакцию/строчную блокировку ради
 *     чтения одной строки было бы избыточно (`findByIdForUpdate` — для сценариев,
 *     где за чтением следует запись в той же транзакции, здесь такого нет).
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
  /** `'delivery_handover'` — ДОБАВЛЕНО (DTJ-305, EP-12 §A.5): `CompletePickingUseCase`
   *  (`modules/orders`) переиспользует ЭТОТ порт межмодульно, тем же приёмом, что `JWT_SIGNER`. */
  readonly purpose: 'login' | 'onboarding_contact' | 'delivery_handover'
  readonly codeHash: string
  /** ДОБАВЛЕНО (DTJ-306, EP-12 §A.5) — код в открытом виде, заполнен ТОЛЬКО когда
   *  `purpose === 'delivery_handover'` (см. JSDoc миграции `0049_otp_codes_plain_code_for_handover.sql`).
   *  `null` для `login`/`onboarding_contact` — те остаются хеш-only. */
  readonly plainCode: string | null
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
  readonly purpose: 'login' | 'onboarding_contact' | 'delivery_handover'
  readonly codeHash: string
  /** См. `OtpCodeRecord.plainCode` — передавать ТОЛЬКО для `purpose='delivery_handover'`. */
  readonly plainCode?: string
  readonly issuedAt: Date
  readonly expiresAt: Date
}

export interface OtpCodesRepository {
  create(input: CreateOtpCodeInput): Promise<OtpCodeRecord>
  findById(id: string): Promise<OtpCodeRecord | null>
  findByIdForUpdate(tx: UnitOfWorkTx, id: string): Promise<OtpCodeRecord | null>
  markConsumed(tx: UnitOfWorkTx, id: string, now: Date): Promise<void>
  incrementAttempts(tx: UnitOfWorkTx, id: string): Promise<void>
  findActiveBySubject(input: {
    readonly tenantId: string
    readonly subjectRef: string
    readonly purpose: 'login' | 'onboarding_contact'
    readonly now: Date
  }): Promise<OtpCodeRecord | null>
  /** ДОБАВЛЕНО (DTJ-306, EP-12 §A.5) — сколько строк `otp_codes` когда-либо создано для
   *  `subjectRef+purpose` (включая самую первую) — `RegenerateHandoverOtpUseCase` считает
   *  `regenerationsUsed`/rate-limit по этому числу, не по отдельному денормализованному
   *  счётчику (append-only таблица уже несёт эту информацию, `02` C15). */
  countBySubjectAndPurpose(tenantId: string, subjectRef: string, purpose: 'delivery_handover'): Promise<number>
}
