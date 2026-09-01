/**
 * Value Object `InventoryBatchUpsertRow` (EP-05, DTJ-145) — одна строка инвентаря
 * в синхронизации из любого канала (Excel/CSV, ручной ввод, REST).
 *
 * Контракт (SRS-INV-002, 003, 004, 005):
 *   - `medicineId` — UUID v4 из каталога. `barcode` — ОПЦИОНАЛЬНОЕ ДУБЛИРОВАНИЕ
 *     (DTJ-146 composite-матчинг по штрихкоду; если указан, должен проходить
 *     `Barcode.parse`).
 *   - `price` — целые дирамы (J7, D-13). 0 допустим (благотворительность/промо).
 *   - `quantity` — целое неотрицательное. `0` = нет в наличии.
 *   - `expiresAt` — ISO-8601, должна быть в будущем относительно `now`.
 *     TODO(EP-05/Inventory): batch может приходить со старыми сроками — для
 *     обратной загрузки исторических остатков. Сейчас — strict (`expiresAt > now`).
 *   - `batchNumber` — опциональная серия (для отслеживания партий производителя).
 *
 * Чистый domain (`02` §2): ноль I/O, ноль `Date.now()` — `now` передаётся
 * параметром. Валидация — через `Result`, исключения только для invariant violation
 * (что не должно случиться при валидном вводе).
 */
import { Barcode, err, ok, type Result } from '@dorutj/domain-kernel'
import { InvalidInventoryRowError } from '../errors/inventory.errors.js'

/** Верхняя граница `price` (1 млрд дирамов = 10 млн TJS, заведомо достаточно). */
const MAX_PRICE_DIRAMS = 1_000_000_000

/** Минимальный ISO-8601 date для `expiresAt` (10 символов, `YYYY-MM-DD`). */
const ISO_DATE_LENGTH = 10

export interface InventoryBatchUpsertRowProps {
  readonly medicineId: string
  readonly barcode: string | null
  readonly price: number
  readonly quantity: number
  readonly expiresAt: string
  readonly batchNumber: string | null
}

export class InventoryBatchUpsertRow {
  private readonly _medicineId: string
  private readonly _barcode: string | null
  private readonly _price: number
  private readonly _quantity: number
  private readonly _expiresAt: string
  private readonly _batchNumber: string | null

  private constructor(props: InventoryBatchUpsertRowProps) {
    this._medicineId = props.medicineId
    this._barcode = props.barcode
    this._price = props.price
    this._quantity = props.quantity
    this._expiresAt = props.expiresAt
    this._batchNumber = props.batchNumber
  }

  /**
   * Создаёт VO с валидацией. Проверяет:
   *   - `medicineId` — непустая строка;
   *   - `barcode` — null или валидный по `Barcode.parse` (SRS-INV-008);
   *   - `price` — целое ≥ 0, ≤ MAX_PRICE_DIRAMS;
   *   - `quantity` — целое ≥ 0;
   *   - `expiresAt` — корректный ISO-8601 date в будущем.
   */
  public static create(
    props: InventoryBatchUpsertRowProps,
    now: Date,
  ): Result<InventoryBatchUpsertRow, InvalidInventoryRowError> {
    const medicineIdCheck = validateMedicineId(props.medicineId)
    if (medicineIdCheck !== null) {
      return err(medicineIdCheck)
    }
    const barcodeCheck = validateBarcode(props.barcode)
    if (barcodeCheck !== null) {
      return err(barcodeCheck)
    }
    const priceCheck = validatePrice(props.price)
    if (priceCheck !== null) {
      return err(priceCheck)
    }
    const quantityCheck = validateQuantity(props.quantity)
    if (quantityCheck !== null) {
      return err(quantityCheck)
    }
    const expiresAtCheck = validateExpiresAt(props.expiresAt, now)
    if (expiresAtCheck !== null) {
      return err(expiresAtCheck)
    }
    return ok(new InventoryBatchUpsertRow(props))
  }

  public getMedicineId(): string {
    return this._medicineId
  }

  public getBarcode(): string | null {
    return this._barcode
  }

  public getPrice(): number {
    return this._price
  }

  public getQuantity(): number {
    return this._quantity
  }

  public getExpiresAt(): string {
    return this._expiresAt
  }

  public getBatchNumber(): string | null {
    return this._batchNumber
  }
}

function validateMedicineId(raw: string): InvalidInventoryRowError | null {
  if (raw.trim() === '') {
    return new InvalidInventoryRowError('medicineId must be non-empty')
  }
  return null
}

function validateBarcode(raw: string | null): InvalidInventoryRowError | null {
  if (raw === null) return null
  const parsed = Barcode.parse(raw)
  // non_ean13 допустим как локальный (внутренний) штрихкод аптеки — но для
  // глобального матчинга (D-06) он бесполезен. Здесь мы не валидируем формат;
  // downstream composite-matcher (DTJ-146) решит.
  if (parsed.getRawValue() === '') {
    return new InvalidInventoryRowError('barcode is empty after trim')
  }
  return null
}

function validatePrice(price: number): InvalidInventoryRowError | null {
  if (!Number.isInteger(price) || price < 0 || price > MAX_PRICE_DIRAMS) {
    return new InvalidInventoryRowError(
      `price must be integer dirams in [0, ${String(MAX_PRICE_DIRAMS)}], got ${String(price)}`,
    )
  }
  return null
}

function validateQuantity(quantity: number): InvalidInventoryRowError | null {
  if (!Number.isInteger(quantity) || quantity < 0) {
    return new InvalidInventoryRowError(
      `quantity must be non-negative integer, got ${String(quantity)}`,
    )
  }
  return null
}

function validateExpiresAt(raw: string, now: Date): InvalidInventoryRowError | null {
  if (raw.length < ISO_DATE_LENGTH) {
    return new InvalidInventoryRowError(
      `expiresAt must be ISO-8601 date (at least ${String(ISO_DATE_LENGTH)} chars)`,
    )
  }
  // eslint-disable-next-line no-restricted-globals -- парсинг ISO-строки в `Date`
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    return new InvalidInventoryRowError(`expiresAt is not a valid date: ${raw}`)
  }
  if (date.getTime() <= now.getTime()) {
    return new InvalidInventoryRowError(
      `expiresAt must be in the future, got ${raw}, now=${now.toISOString()}`,
    )
  }
  return null
}
