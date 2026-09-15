/**
 * Агрегат `InventorySyncBatch` (EP-05, DTJ-144, SRS-DOM-145..150).
 *
 * Глоссарий (см. DTJ-144 §«Задача»): НЕ путать с
 *   - `PharmacyInventory` (DTJ-143) — остаток по аптеке;
 *   - `InventoryBatchUpsertRow` (DTJ-145) — VO строки входящей команды.
 *
 * Этот агрегат — ОДНО СОСТОЯНИЕ БАТЧА-ЗАПРОСА синхронизации. FSM:
 *
 *   queued
 *     │ markProcessing()
 *     ▼
 *   processing
 *     │ markCompletedFullSuccess()
 *     │ markCompletedPartialSuccess(acceptedRows, rejectedRows)
 *     │ markFailedValidation()
 *     ▼
 *   (terminal)
 *
 * Терминальные статусы (`completed_full_success`, `completed_partial_success`,
 * `failed_validation`) НЕОБРАТИМЫ (SRS-DOM-150): любой переход из
 * терминального статуса бросает `IllegalBatchStatusTransitionError`.
 * Переход `queued → completed_*` напрямую ЗАПРЕЩЁН (обязателен
 * `processing`).
 *
 * Идемпотентность повторной отправки того же `batch_id` (SRS-INV-009,
 * SRS-DOM-168) — на уровне репозитория (`UNIQUE(id)` + `ON CONFLICT DO
 * NOTHING RETURNING *`). Агрегат лишь отдаёт текущее состояние через
 * `getSnapshot()`, не повторно исполняя бизнес-логику.
 *
 * Домен — чистый: ноль I/O, ноль `Date.now()`. `now: Date` приходит
 * параметром из application через `Clock`-порт (`02` §2.6).
 */
import { type InventorySyncChannel } from './inventory-sync.types.js'
import { IllegalBatchStatusTransitionError } from './errors/inventory.errors.js'

/** Возможные статусы FSM. Литералы — нормативно (SRS-DOM-145..150). */
export type BatchStatus =
  | 'queued'
  | 'processing'
  | 'completed_full_success'
  | 'completed_partial_success'
  | 'failed_validation'

export type SyncType = 'delta' | 'full'

/** Таблица разрешённых переходов (SRS-DOM-150). Терминальные → `[]`. */
const ALLOWED_TRANSITIONS: Readonly<Record<BatchStatus, readonly BatchStatus[]>> = {
  queued: ['processing'],
  processing: ['completed_full_success', 'completed_partial_success', 'failed_validation'],
  completed_full_success: [],
  completed_partial_success: [],
  failed_validation: [],
}

export interface InventorySyncBatchCreateProps {
  readonly id: string
  readonly pharmacyId: string
  readonly channel: InventorySyncChannel
  readonly syncType: SyncType
  readonly totalRows: number
  readonly fullSyncSessionId?: string
  readonly pageNumber?: number
  readonly isLastPage?: boolean
  /** DTJ-161/163/164 — группирующий UUID Excel-загрузки. `undefined` → `null` (каналы без группировки). */
  readonly sourceUploadId?: string
}

export interface InventorySyncBatchSnapshot {
  readonly id: string
  readonly pharmacyId: string
  readonly channel: InventorySyncChannel
  readonly syncType: SyncType
  readonly status: BatchStatus
  readonly totalRows: number
  readonly acceptedRows: number
  readonly rejectedRows: number
  readonly fullSyncSessionId: string | null
  readonly pageNumber: number
  readonly isLastPage: boolean
  readonly receivedAt: Date
  readonly completedAt: Date | null
  readonly errorSummary: readonly { readonly rowIndex: number; readonly reason: string }[] | null
  readonly note: string | null
  /** Optional (не все существующие вызовы `restore(...)` его знают) — `undefined` трактуется как `null`. */
  readonly sourceUploadId?: string | null
}

const MAX_TOTAL_ROWS = 100_000

export class InventorySyncBatch {
  private readonly _receivedAt: Date
  private _status: BatchStatus
  private _acceptedRows: number
  private _rejectedRows: number
  private _completedAt: Date | null
  private _errorSummary: readonly { readonly rowIndex: number; readonly reason: string }[] | null

  readonly id: string
  readonly pharmacyId: string
  readonly channel: InventorySyncChannel
  readonly syncType: SyncType
  readonly totalRows: number
  readonly fullSyncSessionId: string | null
  readonly pageNumber: number
  readonly isLastPage: boolean
  readonly note: string | null
  readonly sourceUploadId: string | null

  /** Единственный параметр-снапшот (C1/max-params) — поля см. `InventorySyncBatchSnapshot`. */
  private constructor(snapshot: InventorySyncBatchSnapshot) {
    this.id = snapshot.id
    this.pharmacyId = snapshot.pharmacyId
    this.channel = snapshot.channel
    this.syncType = snapshot.syncType
    this.totalRows = snapshot.totalRows
    this.fullSyncSessionId = snapshot.fullSyncSessionId
    this.pageNumber = snapshot.pageNumber
    this.isLastPage = snapshot.isLastPage
    this.note = snapshot.note
    this.sourceUploadId = snapshot.sourceUploadId ?? null
    this._receivedAt = snapshot.receivedAt
    this._status = snapshot.status
    this._acceptedRows = snapshot.acceptedRows
    this._rejectedRows = snapshot.rejectedRows
    this._completedAt = snapshot.completedAt
    this._errorSummary = snapshot.errorSummary
  }

  /**
   * Создаёт батч в начальном статусе `queued`. Валидирует входные данные.
   * `receivedAt` ставится `now` (параметр из application, не `Date.now()`).
   */
  static create(
    props: InventorySyncBatchCreateProps,
    now: Date,
    note: string | null = null,
  ): InventorySyncBatch {
    InventorySyncBatch.validateCreateProps(props)
    const pageNumber = props.pageNumber ?? 1
    InventorySyncBatch.validatePageNumber(pageNumber)
    return new InventorySyncBatch({
      id: props.id,
      pharmacyId: props.pharmacyId,
      channel: props.channel,
      syncType: props.syncType,
      totalRows: props.totalRows,
      fullSyncSessionId: props.fullSyncSessionId ?? null,
      pageNumber,
      isLastPage: props.isLastPage ?? true,
      receivedAt: now,
      status: 'queued',
      acceptedRows: 0,
      rejectedRows: 0,
      completedAt: null,
      errorSummary: null,
      note,
      sourceUploadId: props.sourceUploadId ?? null,
    })
  }

  /** Валидация входных `props` для `create` (без `pageNumber` — см. `validatePageNumber`). */
  private static validateCreateProps(props: InventorySyncBatchCreateProps): void {
    if (props.id.trim() === '') {
      throw new Error('id must be non-empty')
    }
    if (props.pharmacyId.trim() === '') {
      throw new Error('pharmacyId must be non-empty')
    }
    if (!Number.isInteger(props.totalRows) || props.totalRows < 0) {
      throw new Error(`totalRows must be non-negative integer, got ${String(props.totalRows)}`)
    }
    if (props.totalRows > MAX_TOTAL_ROWS) {
      throw new Error(`totalRows exceeds cap ${String(MAX_TOTAL_ROWS)}`)
    }
    if (props.syncType === 'full' && props.fullSyncSessionId === undefined) {
      throw new Error('fullSyncSessionId is required for syncType=full')
    }
    if (props.syncType === 'delta' && props.fullSyncSessionId !== undefined) {
      throw new Error('fullSyncSessionId must be undefined for syncType=delta')
    }
  }

  private static validatePageNumber(pageNumber: number): void {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new Error(`pageNumber must be integer >= 1, got ${String(pageNumber)}`)
    }
  }

  /**
   * `restore` — доверие БД, повторная валидация НЕ выполняется (DTO прошёл
   * при записи). Бросает только при структурно невозможных данных
   * (например, терминальный статус + completedAt=null — corruption).
   */
  static restore(snapshot: InventorySyncBatchSnapshot): InventorySyncBatch {
    return new InventorySyncBatch(snapshot)
  }

  /** Текущий статус FSM. */
  get status(): BatchStatus {
    return this._status
  }

  /** Принято строк воркером (для `completed_partial_success`). */
  get acceptedRows(): number {
    return this._acceptedRows
  }

  /** Отклонено строк (для `completed_partial_success` / `failed_validation`). */
  get rejectedRows(): number {
    return this._rejectedRows
  }

  /** Момент получения (от фронта/1С/Excel-загрузки). */
  get receivedAt(): Date {
    return this._receivedAt
  }

  /** Момент терминального перехода (null для не-терминальных). */
  get completedAt(): Date | null {
    return this._completedAt
  }

  /** Снимок ошибок по строкам. `null` пока `errorSummary` не заполнен. */
  get errorSummary(): readonly { readonly rowIndex: number; readonly reason: string }[] | null {
    return this._errorSummary
  }

  /** Терминальные статусы (SRS-DOM-150). */
  get isTerminal(): boolean {
    return ALLOWED_TRANSITIONS[this._status].length === 0
  }

  /**
   * `true` если это последняя страница `full`-синхронизации.
   * Используется DTJ-151 как триггер «обнуление отсутствующих позиций»
   * (SRS-INV-041).
   */
  get isFullSyncLastPage(): boolean {
    return this.syncType === 'full' && this.isLastPage
  }

  /** `queued → processing` (обязателен, переход напрямую в completed запрещён). */
  markProcessing(): void {
    this.transitionTo('processing')
  }

  /** `processing → completed_full_success` (терминальный). */
  markCompletedFullSuccess(): void {
    this.transitionTo('completed_full_success')
  }

  /**
   * `processing → completed_partial_success` (терминальный). Параметры —
   * счётчики воркера; `acceptedRows + rejectedRows` должны сходиться
   * к `totalRows` (иначе — internal error, не доменное правило).
   */
  markCompletedPartialSuccess(acceptedRows: number, rejectedRows: number, now: Date): void {
    assertNonNegativeInt('acceptedRows', acceptedRows)
    assertNonNegativeInt('rejectedRows', rejectedRows)
    if (acceptedRows + rejectedRows !== this.totalRows) {
      throw new Error(
        `partial success counters inconsistent: acceptedRows=${String(acceptedRows)} + rejectedRows=${String(rejectedRows)} != totalRows=${String(this.totalRows)}`,
      )
    }
    this._acceptedRows = acceptedRows
    this._rejectedRows = rejectedRows
    this._completedAt = now
    this.transitionTo('completed_partial_success')
  }

  /** `processing → failed_validation` (терминальный). */
  markFailedValidation(errors: readonly { readonly rowIndex: number; readonly reason: string }[], now: Date): void {
    if (errors.length === 0) {
      throw new Error('failed_validation requires non-empty errors')
    }
    this._errorSummary = [...errors]
    this._rejectedRows = errors.length
    this._completedAt = now
    this.transitionTo('failed_validation')
  }

  /**
   * Проверяет `ALLOWED_TRANSITIONS`, бросает
   * `IllegalBatchStatusTransitionError(from, to)` при недопустимом
   * переходе. Публичный API — тонкие обёртки выше; этот метод приватный
   * по соглашению (нет публичного сеттера на `status`).
   */
  private transitionTo(next: BatchStatus): void {
    const allowed = ALLOWED_TRANSITIONS[this._status]
    if (!allowed.includes(next)) {
      throw new IllegalBatchStatusTransitionError(this._status, next)
    }
    this._status = next
  }

  /** Снимок для outbox-событий / репозитория. */
  toSnapshot(): InventorySyncBatchSnapshot {
    return {
      id: this.id,
      pharmacyId: this.pharmacyId,
      channel: this.channel,
      syncType: this.syncType,
      status: this._status,
      totalRows: this.totalRows,
      acceptedRows: this._acceptedRows,
      rejectedRows: this._rejectedRows,
      fullSyncSessionId: this.fullSyncSessionId,
      pageNumber: this.pageNumber,
      isLastPage: this.isLastPage,
      receivedAt: this._receivedAt,
      completedAt: this._completedAt,
      errorSummary: this._errorSummary,
      note: this.note,
      sourceUploadId: this.sourceUploadId,
    }
  }
}

function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be non-negative integer, got ${String(value)}`)
  }
}
