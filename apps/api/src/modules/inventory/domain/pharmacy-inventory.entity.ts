/**
 * Агрегат `PharmacyInventory` (EP-05, DTJ-143, SRS-DOM-018..024).
 *
 * Глоссарий имён (см. DTJ-143 §«Терминологическая ловушка»):
 *   - `InventoryLot`        — партия товара внутри ЭТОГО агрегата (БД: одна
 *                             строка `pharmacy_inventory` или её дочерняя
 *                             таблица, если позже выделим). БД-имя —
 *                             `pharmacy_inventory` row.
 *   - `InventoryBatchUpsertRow` (DTJ-145) — VO входящей строки команды
 *                             синхронизации. Не путать с партией.
 *   - `InventorySyncBatch`  (DTJ-144) — агрегат состояния батча-запроса
 *                             (received → processing → completed|failed).
 *                             Тоже не путать с партией.
 *
 * Агрегат инкапсулирует инварианты:
 *   - `price >= 0` (J7, SRS-DOM-020).
 *   - `quantity >= 0` (SRS-DOM-021).
 *   - `expiresAt > today` для «продаваемого» остатка (SRS-DOM-087).
 *   - FEFO: наружу отдаётся `getFefoLot(today)` — партия с минимальным
 *     `expiryDate` среди `quantity > 0 AND expiryDate > today`
 *     (SRS-DOM-019, SRS-DOM-020).
 *   - Stale-фильтр (SRS-DOM-024): если `syncTimestamp <= existing.lastSyncedAt`,
 *     delta отбрасывается — старая пачка не должна перезаписать свежую
 *     после гонки push'ей из 1С.
 *
 * Домен — чистый: ноль I/O, ноль `Date.now()`. `now` передаётся параметром
 * каждого метода, который нуждается во времени (правило
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.6).
 */
import { err, ok, type Result } from '@dorutj/domain-kernel'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { ExpiryDate } from '@/shared-kernel/domain/value-objects/expiry-date.vo.js'
import { InvalidMoneyError } from '@/shared-kernel/domain/errors/invalid-money.error.js'
import { InvalidInventoryRowError } from './errors/inventory.errors.js'

const MAX_QUANTITY = 1_000_000
const MAX_BATCH_NUMBER_LENGTH = 64

export interface InventoryLotProps {
  readonly batchNumber: string | null
  readonly priceDiram: bigint
  readonly quantity: number
  readonly expiryDateIso: string
  readonly lastSyncedAt: Date
}

/** Партия товара внутри `PharmacyInventory`. Иммутабельная. */
export class InventoryLot {
  private constructor(props: {
    batchNumber: string | null
    price: Money
    quantity: number
    expiryDate: ExpiryDate
    lastSyncedAt: Date
  }) {
    this.batchNumber = props.batchNumber
    this.price = props.price
    this.quantity = props.quantity
    this.expiryDate = props.expiryDate
    this.lastSyncedAt = props.lastSyncedAt
  }

  readonly batchNumber: string | null
  readonly price: Money
  readonly quantity: number
  readonly expiryDate: ExpiryDate
  readonly lastSyncedAt: Date

  static create(props: InventoryLotProps): Result<InventoryLot, InvalidInventoryRowError> {
    const quantityError = InventoryLot.validateQuantity(props.quantity)
    if (quantityError !== null) return err(quantityError)
    const parsed = InventoryLot.parsePriceAndExpiry(props)
    if (!parsed.ok) return err(parsed.error)
    const batchNumberError = InventoryLot.validateBatchNumber(props.batchNumber)
    if (batchNumberError !== null) return err(batchNumberError)
    return ok(
      new InventoryLot({
        batchNumber: props.batchNumber,
        price: parsed.value.price,
        quantity: props.quantity,
        expiryDate: parsed.value.expiryDate,
        lastSyncedAt: props.lastSyncedAt,
      }),
    )
  }

  private static validateQuantity(quantity: number): InvalidInventoryRowError | null {
    if (!Number.isInteger(quantity) || quantity < 0) {
      return new InvalidInventoryRowError(
        `quantity must be non-negative integer, got ${String(quantity)}`,
      )
    }
    if (quantity > MAX_QUANTITY) {
      return new InvalidInventoryRowError(
        `quantity exceeds cap ${String(MAX_QUANTITY)}, got ${String(quantity)}`,
      )
    }
    return null
  }

  private static parsePriceAndExpiry(
    props: InventoryLotProps,
  ): Result<{ readonly price: Money; readonly expiryDate: ExpiryDate }, InvalidInventoryRowError> {
    const priceResult = tryCreatePrice(props.priceDiram)
    if (priceResult === null) {
      return err(
        new InvalidInventoryRowError(
          `price cannot be negative: ${props.priceDiram.toString()} dirams`,
        ),
      )
    }
    const expiryResult = ExpiryDate.parse(props.expiryDateIso)
    if (!expiryResult.ok) {
      return err(
        new InvalidInventoryRowError(`expiryDate is invalid: ${expiryResult.error.message}`),
      )
    }
    return ok({ price: priceResult, expiryDate: expiryResult.value })
  }

  private static validateBatchNumber(batchNumber: string | null): InvalidInventoryRowError | null {
    if (batchNumber !== null && batchNumber.length > MAX_BATCH_NUMBER_LENGTH) {
      return new InvalidInventoryRowError(
        `batchNumber length exceeds ${String(MAX_BATCH_NUMBER_LENGTH)}`,
      )
    }
    return null
  }

  /**
   * FEFO-ключ — нормализованный `batchNumber` (пустая строка = `null`,
   * чтобы сортировка `null`-партий была стабильна).
   */
  getFefoKey(): string {
    return this.batchNumber ?? ''
  }
}

export interface PharmacyInventorySnapshot {
  readonly id: string
  readonly pharmacyId: string
  readonly medicineId: string
  readonly lots: readonly InventoryLotProps[]
}

/** Результат `applyDelta` — «применилось» или «устарело» (SRS-DOM-024). */
export type ApplyDeltaResult =
  | { readonly applied: true; readonly lot: InventoryLot }
  | { readonly applied: false; readonly reason: 'stale' }

export interface PharmacyInventoryCreateProps {
  readonly id: string
  readonly pharmacyId: string
  readonly medicineId: string
  readonly initialLots?: readonly InventoryLotProps[]
}

export class PharmacyInventory {
  private readonly _lots: InventoryLot[]

  readonly id: string
  readonly pharmacyId: string
  readonly medicineId: string

  private constructor(props: {
    id: string
    pharmacyId: string
    medicineId: string
    lots: readonly InventoryLot[]
  }) {
    this.id = props.id
    this.pharmacyId = props.pharmacyId
    this.medicineId = props.medicineId
    this._lots = [...props.lots]
  }

  /** Фабрика «с нуля» — валидирует все лоты (для `restore` см. ниже). */
  static create(props: PharmacyInventoryCreateProps): Result<PharmacyInventory, InvalidInventoryRowError> {
    if (props.id.trim() === '') {
      return err(new InvalidInventoryRowError('id must be non-empty'))
    }
    if (props.pharmacyId.trim() === '') {
      return err(new InvalidInventoryRowError('pharmacyId must be non-empty'))
    }
    if (props.medicineId.trim() === '') {
      return err(new InvalidInventoryRowError('medicineId must be non-empty'))
    }
    const lots: InventoryLot[] = []
    const initial = props.initialLots ?? []
    for (const lotProps of initial) {
      const lotResult = InventoryLot.create(lotProps)
      if (!lotResult.ok) {
        return err(lotResult.error)
      }
      lots.push(lotResult.value)
    }
    return ok(new PharmacyInventory({ id: props.id, pharmacyId: props.pharmacyId, medicineId: props.medicineId, lots }))
  }

  /**
   * `restore` — доверие БД, повторная валидация инвариантов НЕ выполняется
   * (DTO прошёл при записи). `InvalidInventoryRowError` всё равно возможен
   * при миграциях, повредивших данные — это считаем corruption.
   */
  static restore(snapshot: PharmacyInventorySnapshot): Result<PharmacyInventory, InvalidInventoryRowError> {
    const lots: InventoryLot[] = []
    for (const lotProps of snapshot.lots) {
      const lotResult = InventoryLot.create(lotProps)
      if (!lotResult.ok) {
        return err(lotResult.error)
      }
      lots.push(lotResult.value)
    }
    return ok(new PharmacyInventory({ id: snapshot.id, pharmacyId: snapshot.pharmacyId, medicineId: snapshot.medicineId, lots }))
  }

  /**
   * Суммарный остаток в `quantity` для продаваемых лотов
   * (SRS-DOM-019: `quantity > 0 AND expiryDate > today`).
   * Просроченные (`quantity > 0` но `expiryDate <= today`) НЕ считаются.
   * `today` — параметр (домен не зовёт `Clock`).
   */
  stockQuantity(today: Date): number {
    let total = 0
    for (const lot of this._lots) {
      if (lot.quantity > 0 && lot.expiryDate.isSellable(today)) {
        total += lot.quantity
      }
    }
    return total
  }

  /**
   * FEFO-партия — минимальный `expiryDate` среди `quantity > 0 AND
   * expiryDate > today` (SRS-DOM-020). Возвращает `null`, если продаваемых
   * лотов нет. Эту партию каталог показывает в `displayPrice`/
   * `displayExpiryDate`.
   */
  getFefoLot(today: Date): InventoryLot | null {
    let best: InventoryLot | null = null
    for (const lot of this._lots) {
      if (lot.quantity <= 0 || !lot.expiryDate.isSellable(today)) {
        continue
      }
      if (best === null || lot.expiryDate.isoDate < best.expiryDate.isoDate) {
        best = lot
      }
    }
    return best
  }

  /**
   * Применить delta-обновление лота (SRS-DOM-024):
   *   - ищет лот по `batchNumber`;
   *   - если `syncTimestamp <= existing.lastSyncedAt` → отбрасывается как
   *     stale (гонка пачек из 1С);
   *   - иначе — заменяет/добавляет лот.
   *
   * Мутация — IN-PLACE (агрегат владеет коллекцией). Возвращает `{ applied,
   * lot }`, чтобы вызывающий код мог узнать итоговый снимок лота для
   * записи в `outbox` (DTJ-153) без повторного поиска.
   */
  applyDelta(input: InventoryLotProps): ApplyDeltaResult {
    const lotResult = InventoryLot.create(input)
    if (!lotResult.ok) {
      return { applied: false, reason: 'stale' }
    }
    const incoming = lotResult.value
    const existingIndex = this._lots.findIndex(
      (lot) => lot.getFefoKey() === incoming.getFefoKey(),
    )
    if (existingIndex !== -1) {
      const existing = this._lots[existingIndex]
      if (existing === undefined) {
        return { applied: false, reason: 'stale' }
      }
      if (incoming.lastSyncedAt.getTime() <= existing.lastSyncedAt.getTime()) {
        return { applied: false, reason: 'stale' }
      }
      this._lots[existingIndex] = incoming
      return { applied: true, lot: incoming }
    }
    this._lots.push(incoming)
    return { applied: true, lot: incoming }
  }

  /** Текущие лоты — для репозитория. */
  getLots(): readonly InventoryLot[] {
    return this._lots
  }

  /** Снимок — для `restore` или передачи в outbox-события. */
  toSnapshot(): PharmacyInventorySnapshot {
    return {
      id: this.id,
      pharmacyId: this.pharmacyId,
      medicineId: this.medicineId,
      lots: this._lots.map(toLotProps),
    }
  }
}

function tryCreatePrice(diram: bigint): Money | null {
  try {
    return Money.fromDiram(diram)
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      return null
    }
    throw error
  }
}

function toLotProps(lot: InventoryLot): InventoryLotProps {
  return {
    batchNumber: lot.batchNumber,
    priceDiram: lot.price.diram,
    quantity: lot.quantity,
    expiryDateIso: lot.expiryDate.isoDate,
    lastSyncedAt: lot.lastSyncedAt,
  }
}
