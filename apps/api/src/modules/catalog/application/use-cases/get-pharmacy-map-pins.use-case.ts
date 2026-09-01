/**
 * `GetPharmacyMapPinsUseCase` (DTJ-196, EP-08 — Карта аптек, `R1-6`).
 *
 * Единственная задача: `GET /pharmacies/map?bbox=...` (DTJ-197, презентационный слой
 * этого эндпоинта, потребит этот use case контроллером) не должен позволить клиенту с
 * зумом «вся территория Таджикистана» утянуть всю базу аптек одним запросом
 * (`SRS-CAT-054`) — площадь `bbox` проверяется здесь, ДО обращения к репозиторию.
 *
 * `bbox` уже пришёл сюда СТРУКТУРИРОВАННЫМ (`Bbox`, поля `lonMin/latMin/lonMax/latMax`) —
 * разбор и формат-валидация сырой query-строки `lonMin,latMin,lonMax,latMax` — ответственность
 * `packages/contracts` (`PharmacyMapQuerySchema`, DTJ-194) на границе presentation (DTJ-197).
 * Этот use case проверяет только БИЗНЕС-инвариант площади, не формат.
 *
 * **БЛОКЕР (найдено при реализации этого тикета, зафиксировано в отчёте сдачи DTJ-196).**
 * Тикет прямо требует получать `PharmacyOpeningHoursPolicy` (DTJ-184) через конструктор и
 * вычислять `isOpenNow` из СЫРЫХ `is24x7`/`openingTime`/`closingTime`, возвращённых
 * репозиторием (шаг «г» тикета). Фактический порт `PharmacyMapRepository` (DTJ-194,
 * `../pharmacies-map/ports/pharmacy-map-repository.port.ts`, ВНЕ `files_owned` этого тикета)
 * объявляет `PharmacyMapPin.isOpenNow: boolean` УЖЕ ВЫЧИСЛЕННЫМ и НЕ несёт `openingTime`/
 * `closingTime` вовсе — расхождение с текстом тикета уже задокументировано в JSDoc адаптера
 * `postgres-pharmacy-map.adapter.ts` (DTJ-195, «ВАЖНО», п.2): там `isOpenNow` временно
 * вычисляется в `infrastructure` тем же алгоритмом `SRS-CAT-046`, «до тех пор, пока порт
 * DTJ-194 не будет скорректирован (добавит сырые поля)». Скорректировать порт — задача ВНЕ
 * `files_owned` DTJ-196 (Ж7 `AGENTS.md`); правка чужого файла без согласования — риск
 * рассинхронизации с DTJ-195, который тоже его читает.
 *
 * Поэтому здесь `PharmacyOpeningHoursPolicy` НЕ инжектируется: инжектировать порт, который
 * нечем вызвать (нет сырых полей на входе), — заглушка, создающая иллюзию переиспользования
 * (Ж1 `AGENTS.md`, «ложное готово»). Вместо этого `isOpenNow`/`is24x7` полей пина передаются
 * из репозитория В DTO КАК ЕСТЬ (`toMapPinDto` ниже) — они уже корректно вычислены (тем же
 * алгоритмом `SRS-CAT-046`), только временно в неверном слое. Когда порт DTJ-194 будет
 * скорректирован (вернёт `openingTime`/`closingTime`, уберёт предвычисленный `isOpenNow`) —
 * этот файл нужно переоткрыть: внедрить `PharmacyOpeningHoursPolicy` через конструктор и
 * заменить `toMapPinDto` на вызов `policy.evaluate()`, как и было изначально задумано тикетом.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-052, SRS-CAT-054, TC-CAT-024)
 * @see tickets/ep05-search-map/DTJ-196.md
 */
import { Inject, Injectable } from '@nestjs/common'
import { ValidationError, type BboxCoordinates } from '@dorutj/contracts'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { TenantId } from '@/modules/tenancy/index.js'
import {
  BBOX_MAX_AREA_KM2,
  PHARMACY_MAP_REPOSITORY,
  type BboxQuery,
  type PharmacyMapPin,
  type PharmacyMapRepository,
} from '../pharmacies-map/ports/pharmacy-map-repository.port.js'

/**
 * `Bbox` — тот же формат, что и `BboxCoordinates` (`@dorutj/contracts`, DTJ-194): use case
 * НЕ объявляет собственную дублирующую форму (Ж12 `AGENTS.md`), только семантический алиас
 * для читаемости сигнатуры `execute()` (соответствует названию из текста тикета).
 */
export type Bbox = BboxCoordinates

/** Перевод м² → км² для итоговой площади `bbox`. */
const SQUARE_METERS_PER_SQUARE_KM = 1_000_000

/**
 * `SRS-CAT-054`/`TC-CAT-024`: площадь `bbox` превышает `BBOX_MAX_AREA_KM2`. Наследует
 * канонический `ValidationError` (`@dorutj/contracts`, DTJ-005) — код `VALIDATION_ERROR`
 * и `details.field='bbox'` проставляются автоматически, глобальный `DomainExceptionFilter`
 * (`@Catch(DomainError)`) маппит её в `400` без какого-либо специального кода в presentation
 * (DTJ-197) — критерий приёмки 1/4 этого тикета покрывается без участия следующего.
 */
export class BboxTooLargeError extends ValidationError {
  constructor(areaKm2: number) {
    super(
      `bbox area ${areaKm2.toFixed(2)} km² exceeds BBOX_MAX_AREA_KM2=${String(BBOX_MAX_AREA_KM2)} km² (SRS-CAT-054)`,
      { field: 'bbox', areaKm2, maxAreaKm2: BBOX_MAX_AREA_KM2 },
    )
  }
}

/** Параметры `execute()` (шаг 1 тикета). */
export interface GetPharmacyMapPinsCommand {
  readonly bbox: Bbox
  readonly medicineId?: string
  readonly tenantId: TenantId
}

/**
 * Публичный DTO use case'а — ОТДЕЛЬНЫЙ тип от `PharmacyMapPin` репозитория (шаг «д» тикета),
 * даже когда текущее отображение 1:1 (см. БЛОКЕР в JSDoc файла выше): presentation (DTJ-197)
 * зависит от ЭТОГО типа, не от порта репозитория напрямую.
 */
export interface MapPinDto {
  readonly pharmacyId: string
  readonly name: string
  readonly lat: number
  readonly lon: number
  readonly isOpenNow: boolean
  readonly is24x7: boolean
  readonly offer: PharmacyMapPin['offer']
}

@Injectable()
export class GetPharmacyMapPinsUseCase {
  constructor(
    @Inject(PHARMACY_MAP_REPOSITORY)
    private readonly pharmacyMapRepository: PharmacyMapRepository,
  ) {}

  /**
   * Шаги тикета: а) площадь → б) `BboxTooLargeError` при превышении → в) запрос в репозиторий →
   * г)/д) маппинг в `MapPinDto` (обогащение `isOpenNow` — см. БЛОКЕР в JSDoc файла).
   */
  async execute(command: GetPharmacyMapPinsCommand): Promise<readonly MapPinDto[]> {
    const areaKm2 = computeBboxAreaKm2(command.bbox)
    if (areaKm2 > BBOX_MAX_AREA_KM2) {
      // Строго `>`, не `>=` — граница `=== BBOX_MAX_AREA_KM2` ДОПУСТИМА (критерий приёмки 4).
      throw new BboxTooLargeError(areaKm2)
    }
    const pins = await this.pharmacyMapRepository.findPinsInBbox(buildRepositoryQuery(command))
    return pins.map(toMapPinDto)
  }
}

/**
 * `Bbox` (объект) → `BboxQuery` (плоские поля репозитория + `tenantId`). `medicineId`
 * добавляется условно — `exactOptionalPropertyTypes: true` запрещает присваивать
 * `undefined` в опциональное поле явно (тот же приём, что `FindAnalogsUseCase.fetchOffers`).
 */
function buildRepositoryQuery(command: GetPharmacyMapPinsCommand): BboxQuery {
  const baseQuery: BboxQuery = {
    lonMin: command.bbox.lonMin,
    latMin: command.bbox.latMin,
    lonMax: command.bbox.lonMax,
    latMax: command.bbox.latMax,
    tenantId: command.tenantId,
  }
  return command.medicineId === undefined ? baseQuery : { ...baseQuery, medicineId: command.medicineId }
}

/** Критерий приёмки 3: `offer` пробрасывается КАК ЕСТЬ, use case не выдумывает значение. */
function toMapPinDto(pin: PharmacyMapPin): MapPinDto {
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

/**
 * `SRS-CAT-054`, риски тикета (`ASSUMPTION`): приближённая площадь — прямоугольник в
 * градусах, стороны через haversine-расстояние. Переиспользуем `GeoPoint.distanceTo()`
 * (`@/shared-kernel`, `EP-01`/DTJ-009) вместо повторной реализации формулы гаверсинуса
 * (Ж12 `AGENTS.md`) — сжатие Земли у полюсов не учитывается намеренно, порог сам по себе
 * грубая защита, не геодезический SLA (не переусложнять, C15).
 */
function computeBboxAreaKm2(bbox: Bbox): number {
  const southWest = geoPointOrThrow(bbox.latMin, bbox.lonMin)
  const southEast = geoPointOrThrow(bbox.latMin, bbox.lonMax)
  const northWest = geoPointOrThrow(bbox.latMax, bbox.lonMin)
  const widthMeters = southWest.distanceTo(southEast)
  const heightMeters = southWest.distanceTo(northWest)
  return (widthMeters * heightMeters) / SQUARE_METERS_PER_SQUARE_KM
}

/**
 * `bbox` уже прошёл формат-валидацию границы (DTJ-194: 4 числа, `min < max` на каждой оси) —
 * здесь дополнительно проверяется абсолютный географический диапазон (`GeoPoint.create`,
 * `lat ∈ [-90,90]`, `lon ∈ [-180,180]`) перед вычислением расстояния между углами. Невалидный
 * диапазон пробрасывается как `InvalidCoordinatesError` (уже `extends ValidationError`,
 * `@dorutj/contracts`) — тот же `400 VALIDATION_ERROR`, что и `BboxTooLargeError`.
 */
function geoPointOrThrow(latitude: number, longitude: number): GeoPoint {
  const result = GeoPoint.create(latitude, longitude)
  if (!result.ok) {
    throw result.error
  }
  return result.value
}
