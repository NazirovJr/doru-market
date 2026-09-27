/**
 * Порт канала CommerceML 1С (DTJ-165, R1 — порт + мок, реальный XML-разбор в R2).
 * `UnresolvedCommerceMlRow` — то же поле-в-поле, что `ParsedExcelRow`, чтобы не заводить
 * вторую модель строки остатка (потребитель докладывает `resolved`/`resolvedMedicineId` сам).
 */
export const COMMERCE_ML_PARSER_PORT = Symbol.for('@dorutj/inventory/commerce-ml-parser')

export interface UnresolvedCommerceMlRow {
  readonly rowIndex: number
  readonly internalSku: string
  readonly rawBarcode: string | null
  readonly rawTradeName: string
  readonly rawDosageForm: string | null
  readonly rawDosageStrength: string | null
  readonly rawManufacturerName: string | null
  readonly priceDiram: bigint
  readonly quantity: number
  readonly expiresAtIso: string
  readonly batchNumber: string | null
}

export interface CommerceMlParseResult {
  readonly rows: readonly UnresolvedCommerceMlRow[]
}

export interface CommerceMlParserPort {
  /** Бросает `CommerceMlMalformedXmlError` (`@dorutj/contracts`), если `xml` не содержит корневой тег CommerceML. */
  parse(xml: Buffer): Promise<CommerceMlParseResult>
}
