/**
 * `PharmacyMapPinDto`/`PharmacyMapResponseDto` (DTJ-197, EP-08, R1-6) — HTTP-контракт
 * `GET /api/v1/pharmacies/map` (SRS-CAT-052).
 *
 * Форма ответа уже объявлена в `packages/contracts` (DTJ-194, `PharmacyMapPinSchema`/
 * `PharmacyMapResponseSchema`) и покрыта своей спекой — presentation НЕ дублирует эти
 * типы (Ж12 `AGENTS.md`), только реэкспортирует их и добавляет маппер из `MapPinDto`
 * use case'а (`GetPharmacyMapPinsUseCase`, DTJ-196) в контрактный DTO.
 *
 * Маппинг сейчас 1:1 по полям (см. JSDoc use case'а, раздел «БЛОКЕР»), но presentation
 * зависит от типа use case'а, а не от контракта напрямую в сигнатуре контроллера —
 * пересборка через явный маппер держит границу `application → presentation` явной
 * даже при полном совпадении формы.
 */
import type { PharmacyMapPinDto, PharmacyMapResponseDto } from '@dorutj/contracts'
import type { MapPinDto } from '@/modules/catalog/application/use-cases/get-pharmacy-map-pins.use-case.js'

export type { PharmacyMapPinDto, PharmacyMapResponseDto }

/** `MapPinDto` (use case) → `PharmacyMapPinDto` (контракт HTTP-ответа). */
export function toPharmacyMapPinDto(pin: MapPinDto): PharmacyMapPinDto {
  return {
    pharmacyId: pin.pharmacyId,
    name: pin.name,
    lat: pin.lat,
    lon: pin.lon,
    isOpenNow: pin.isOpenNow,
    is24x7: pin.is24x7,
    offer: pin.offer,
  }
}

/** Маппинг массива пинов use case'а → тело ответа контроллера. */
export function toPharmacyMapResponseDto(pins: readonly MapPinDto[]): PharmacyMapResponseDto {
  return pins.map(toPharmacyMapPinDto)
}
