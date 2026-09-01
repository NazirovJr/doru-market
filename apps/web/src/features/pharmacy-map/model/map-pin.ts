import type { PharmacyMapPinDto } from '@dorutj/contracts'

/**
 * `MapPin` — алиас `PharmacyMapPinDto` (`@dorutj/contracts`, DTJ-194): тот же shape, что и пин
 * карты аптек, заводить копию запрещено правилом Ж12. Вынесен в отдельный файл `model/`, а НЕ
 * объявлен прямо в `ui/map-view.tsx`, чтобы `ui/pharmacy-pin-popup.tsx` мог импортировать тип, не
 * создавая цикл `map-view.tsx` → `pharmacy-pin-popup.tsx` → `map-view.tsx`
 * (`import-x/no-cycle`/`dependency-cruiser no-circular`, C16).
 */
export type MapPin = PharmacyMapPinDto
