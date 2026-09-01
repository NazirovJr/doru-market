/**
 * Public surface `packages/domain-kernel` — барабаные реэкспорты VO и общего
 * `Result`-типа. Используется модулем `catalog` (EP-04) и модулем `inventory`
 * (EP-05, composite-матчинг D-06).
 */
export { Dosage } from './value-objects/dosage.vo.js'
export { DosageUnit } from './value-objects/dosage-unit.js'
export { DosageForm, DosageFormClass, InvalidDosageFormError } from './value-objects/dosage-form.js'
export { Barcode, type BarcodeFormat, InvalidBarcodeError } from './value-objects/barcode.vo.js'
export {
  DomainError,
  InvalidDosageError,
  DosageParseError,
} from './value-objects/dosage.errors.js'
export { err, isErr, isOk, ok, type Result } from './common/result.js'
