/**
 * Unit-тест `PostgresPharmacyMapAdapter` (DTJ-195, EP-08, R1).
 *
 * Как и `analog-candidates.adapter.spec.ts` (DTJ-100) — testcontainers Postgres ещё не
 * раскатаны (EP-19, `STATE-AND-RESUME-POINT.md` §11.4), поэтому здесь ТОЛЬКО:
 *   1. Форма сгенерированного SQL (мок `DrizzleDb.execute` перехватывает переданный `SQL`-объект,
 *      `renderSql()` разворачивает его — включая вложенные фрагменты — в плоский текст для
 *      проверки подстрок: наличие/отсутствие JOIN на `pharmacy_inventory` (критерий приёмки 3),
 *      наличие `LIMIT`, рубежа видимости, tenant-скоупа, defense-in-depth по `control_category`).
 *   2. Маппинг строки результата → `PharmacyMapPin` (offer null/заполнен, isStale, isOpenNow) —
 *      SQL-семантика (реальный `bbox`-фильтр, реальное исключение suspended-сети/narcotic на
 *      живых данных) НЕ проверяется здесь, это ответственность будущего
 *      `postgres-pharmacy-map.adapter.integration.spec.ts`.
 *
 * Дополнительный блокер сверх EP-19 (см. JSDoc адаптера, п.1): `pharmacies.geo_point` и
 * расширение PostGIS отсутствуют в фактических миграциях — интеграционный тест не может быть
 * написан ДАЖЕ после раскатки testcontainers, пока эта миграция не появится. Зафиксировано как
 * `blockers` в отчёте сдачи DTJ-195, не скрыто `it.skip`/`it.todo` (§9 хендбука).
 */
import { describe, expect, it, vi } from 'vitest'
import { getTableName, is, Table, type SQL } from 'drizzle-orm'
import { PostgresPharmacyMapAdapter } from './postgres-pharmacy-map.adapter.js'
import { TenantId } from '@/modules/tenancy/index.js'
import type {
  BboxQuery,
  PharmacyMapPin,
} from '@/modules/catalog/application/pharmacies-map/ports/pharmacy-map-repository.port.js'

const TENANT_ID = TenantId.from('550e8400-e29b-41d4-a716-446655440000')
const MEDICINE_ID = '650e8400-e29b-41d4-a716-446655440111'
/** 2026-08-31T04:00:00Z = 09:00 Asia/Dushanbe (UTC+5, без DST — DTJ-184). */
const FIXED_NOW_UTC = new Date('2026-08-31T04:00:00.000Z')

function makeQuery(overrides: Partial<BboxQuery> = {}): BboxQuery {
  return {
    lonMin: 68.7,
    latMin: 38.5,
    lonMax: 68.9,
    latMax: 38.7,
    tenantId: TENANT_ID,
    ...overrides,
  }
}

interface DrizzleMock {
  readonly execute: ReturnType<typeof vi.fn>
}

function makeDrizzleMock(rows: readonly Record<string, unknown>[]): DrizzleMock {
  return { execute: vi.fn(() => Promise.resolve(rows)) }
}

interface ClockMock {
  readonly now: ReturnType<typeof vi.fn>
}

function makeClock(now: Date = FIXED_NOW_UTC): ClockMock {
  return { now: vi.fn(() => now) }
}

function makeAdapter(db: DrizzleMock, clock: ClockMock = makeClock()): PostgresPharmacyMapAdapter {
  return new PostgresPharmacyMapAdapter(
    db as unknown as ConstructorParameters<typeof PostgresPharmacyMapAdapter>[0],
    clock as unknown as ConstructorParameters<typeof PostgresPharmacyMapAdapter>[1],
  )
}

/**
 * Плоское текстовое представление drizzle `SQL` — включая вложенные фрагменты
 * (`queryChunks` рекурсивны, см. отчёт сдачи DTJ-195 для примера структуры).
 * НЕ интерпретирует SQL, только конкатенирует его текстовые куски и параметры —
 * достаточно для проверки наличия/отсутствия подстрок (JOIN, LIMIT, литералы).
 */
function renderSql(query: SQL): string {
  return query.queryChunks.map(renderChunk).join(' ')
}

/** `chunk` — объект (не `null`) и несёт собственное поле `key`. Снижает сложность `renderChunk`. */
function hasOwnKey(chunk: unknown, key: string): chunk is Record<string, unknown> {
  return chunk !== null && typeof chunk === 'object' && key in chunk
}

function renderChunk(chunk: unknown): string {
  if (hasOwnKey(chunk, 'queryChunks')) {
    return renderSql(chunk as unknown as SQL)
  }
  if (hasOwnKey(chunk, 'value')) {
    return (chunk.value as readonly string[]).join('')
  }
  // Ссылка на целую таблицу (напр. `FROM ${pharmacies}`) — drizzle `Table`-инстанс.
  // ЛОВУШКА: `PgTable.name` — это НЕ имя таблицы, а колонка `name` этой же таблицы,
  // если такая объявлена в схеме (у `pharmacies` она есть) — настоящее snake_case имя
  // таблицы лежит за `Symbol(drizzle:Name)`, публично читается только через
  // `getTableName()`. Дialect превращает эти объекты в кавыченные идентификаторы только
  // при реальном исполнении; здесь — для проверки подстрок в unit-тесте.
  if (is(chunk, Table)) {
    return getTableName(chunk)
  }
  // Ссылка на колонку (напр. `${pharmacies.status}`) — объект схемы с полем `.name`
  // (реальное snake_case имя колонки).
  if (hasOwnKey(chunk, 'name')) {
    return String(chunk.name)
  }
  return String(chunk)
}

function capturedSql(db: DrizzleMock): string {
  const [query] = db.execute.mock.calls[0] as [SQL]
  return renderSql(query)
}

/** `noUncheckedIndexedAccess`: сужает `readonly PharmacyMapPin[]` до одного элемента без `!`. */
function firstPin(pins: readonly PharmacyMapPin[]): PharmacyMapPin {
  const pin = pins[0]
  if (pin === undefined) {
    throw new Error('Ожидался хотя бы один пин в результате мока')
  }
  return pin
}

const BASE_ROW = {
  pharmacyId: 'ph-1',
  name: 'Аптека №1',
  lon: 68.78,
  lat: 38.55,
  is24x7: false,
  openingTime: '09:00:00',
  closingTime: '21:00:00',
}

describe('PostgresPharmacyMapAdapter (DTJ-195)', () => {
  describe('форма SQL: medicineId отсутствует (критерий приёмки 3)', () => {
    it('НЕ содержит JOIN на pharmacy_inventory', async () => {
      const db = makeDrizzleMock([])
      await makeAdapter(db).findPinsInBbox(makeQuery())
      expect(capturedSql(db)).not.toContain('pharmacy_inventory')
    })

    it('содержит LIMIT 500 (SRS-CAT-061, именованная константа)', async () => {
      const db = makeDrizzleMock([])
      await makeAdapter(db).findPinsInBbox(makeQuery())
      const rendered = capturedSql(db)
      expect(rendered).toContain('LIMIT')
      expect(rendered).toContain('500')
    })

    it('содержит рубеж видимости сети/аптеки (status)', async () => {
      const db = makeDrizzleMock([])
      await makeAdapter(db).findPinsInBbox(makeQuery())
      const rendered = capturedSql(db)
      expect(rendered).toContain("'active'")
      expect(rendered).toContain("'approved', 'active'")
    })

    it('содержит tenant-скоуп (pharmacy_chains.tenant_id / tenants.is_neutral)', async () => {
      const db = makeDrizzleMock([])
      await makeAdapter(db).findPinsInBbox(makeQuery())
      const rendered = capturedSql(db)
      expect(rendered).toContain('tenant_id')
      expect(rendered).toContain('is_neutral')
    })

    it('вызывает db.execute ровно один раз', async () => {
      const db = makeDrizzleMock([])
      await makeAdapter(db).findPinsInBbox(makeQuery())
      expect(db.execute).toHaveBeenCalledTimes(1)
    })
  })

  describe('форма SQL: medicineId передан (критерии приёмки 2, 5)', () => {
    it('содержит LATERAL JOIN на pharmacy_inventory', async () => {
      const db = makeDrizzleMock([])
      await makeAdapter(db).findPinsInBbox(makeQuery({ medicineId: MEDICINE_ID }))
      const rendered = capturedSql(db)
      expect(rendered).toContain('pharmacy_inventory')
      expect(rendered).toContain('LATERAL')
    })

    it('содержит defense-in-depth рубеж control_category (SRS-CAT-055)', async () => {
      const db = makeDrizzleMock([])
      await makeAdapter(db).findPinsInBbox(makeQuery({ medicineId: MEDICINE_ID }))
      expect(capturedSql(db)).toContain("NOT IN ('psychotropic', 'narcotic')")
    })

    it('исключает нулевой остаток (quantity > 0) — не показывать пустое предложение', async () => {
      const db = makeDrizzleMock([])
      await makeAdapter(db).findPinsInBbox(makeQuery({ medicineId: MEDICINE_ID }))
      expect(capturedSql(db)).toContain('quantity')
    })
  })

  describe('маппинг результата → PharmacyMapPin', () => {
    it('пустой результат БД → пустой массив пинов', async () => {
      const pins = await makeAdapter(makeDrizzleMock([])).findPinsInBbox(makeQuery())
      expect(pins).toEqual([])
    })

    it('offer: null, когда medicineId не передан (в строке нет offer-полей)', async () => {
      const db = makeDrizzleMock([BASE_ROW])
      const pin = firstPin(await makeAdapter(db).findPinsInBbox(makeQuery()))
      expect(pin.offer).toBeNull()
      expect(pin.pharmacyId).toBe('ph-1')
    })

    it('offer: null, когда LATERAL не нашёл активный остаток (все offer-поля null)', async () => {
      const row = {
        ...BASE_ROW,
        priceDiram: null,
        stockQuantity: null,
        updatedAt: null,
        inventoryDeltaSlaMinutes: null,
      }
      const db = makeDrizzleMock([row])
      const pin = firstPin(
        await makeAdapter(db).findPinsInBbox(makeQuery({ medicineId: MEDICINE_ID })),
      )
      expect(pin.offer).toBeNull()
    })

    it('offer заполнен и isStale=false, когда синхронизация свежая (2 мин < 5*3 мин SLA)', async () => {
      const row = {
        ...BASE_ROW,
        priceDiram: 1250,
        stockQuantity: 3,
        updatedAt: new Date('2026-08-31T03:58:00.000Z'),
        inventoryDeltaSlaMinutes: 5,
      }
      const db = makeDrizzleMock([row])
      const pin = firstPin(
        await makeAdapter(db, makeClock()).findPinsInBbox(makeQuery({ medicineId: MEDICINE_ID })),
      )
      expect(pin.offer).toEqual({
        priceDiram: 1250,
        stockQuantity: 3,
        lastSyncedAt: '2026-08-31T03:58:00.000Z',
        isStale: false,
      })
    })

    it('isStale=true, когда прошло больше slaMinutes*3 (60 мин > 5*3 мин SLA)', async () => {
      const row = {
        ...BASE_ROW,
        priceDiram: 1250,
        stockQuantity: 3,
        updatedAt: new Date('2026-08-31T03:00:00.000Z'),
        inventoryDeltaSlaMinutes: 5,
      }
      const db = makeDrizzleMock([row])
      const pin = firstPin(
        await makeAdapter(db, makeClock()).findPinsInBbox(makeQuery({ medicineId: MEDICINE_ID })),
      )
      expect(pin.offer?.isStale).toBe(true)
    })
  })

  // ВРЕМЕННОЕ дублирование SRS-CAT-046 (см. JSDoc адаптера п.2) — минимальный набор кейсов,
  // не полная матрица DTJ-184 (та появится вместе с PharmacyOpeningHoursPolicy).
  describe('isOpenNow (SRS-CAT-046)', () => {
    it('is24x7=true → всегда true, даже с null-полями времени (короткое замыкание)', async () => {
      const row = { ...BASE_ROW, is24x7: true, openingTime: null, closingTime: null }
      const db = makeDrizzleMock([row])
      const pin = firstPin(await makeAdapter(db).findPinsInBbox(makeQuery()))
      expect(pin.isOpenNow).toBe(true)
    })

    it('обычный интервал 09:00-21:00, now=09:00 Dushanbe → true (включая границу)', async () => {
      const db = makeDrizzleMock([BASE_ROW])
      const clock = makeClock(new Date('2026-08-31T04:00:00.000Z')) // 09:00 Dushanbe
      const pin = firstPin(await makeAdapter(db, clock).findPinsInBbox(makeQuery()))
      expect(pin.isOpenNow).toBe(true)
    })

    it('обычный интервал 09:00-21:00, now=08:59 Dushanbe → false (граница не включена до начала)', async () => {
      const db = makeDrizzleMock([BASE_ROW])
      const clock = makeClock(new Date('2026-08-31T03:59:00.000Z')) // 08:59 Dushanbe
      const pin = firstPin(await makeAdapter(db, clock).findPinsInBbox(makeQuery()))
      expect(pin.isOpenNow).toBe(false)
    })

    it('переход через полночь 20:00-02:00, now=01:00 Dushanbe → true', async () => {
      const row = { ...BASE_ROW, openingTime: '20:00:00', closingTime: '02:00:00' }
      const db = makeDrizzleMock([row])
      const clock = makeClock(new Date('2026-08-31T20:00:00.000Z')) // 01:00 Dushanbe (след. сутки)
      const pin = firstPin(await makeAdapter(db, clock).findPinsInBbox(makeQuery()))
      expect(pin.isOpenNow).toBe(true)
    })

    it('переход через полночь 20:00-02:00, now=03:00 Dushanbe → false (вне интервала)', async () => {
      const row = { ...BASE_ROW, openingTime: '20:00:00', closingTime: '02:00:00' }
      const db = makeDrizzleMock([row])
      const clock = makeClock(new Date('2026-08-31T22:00:00.000Z')) // 03:00 Dushanbe (след. сутки)
      const pin = firstPin(await makeAdapter(db, clock).findPinsInBbox(makeQuery()))
      expect(pin.isOpenNow).toBe(false)
    })

    it('is24x7=false и openingTime/closingTime=null (дефектные данные) → false, без исключения', async () => {
      const row = { ...BASE_ROW, is24x7: false, openingTime: null, closingTime: null }
      const db = makeDrizzleMock([row])
      const pin = firstPin(await makeAdapter(db).findPinsInBbox(makeQuery()))
      expect(pin.isOpenNow).toBe(false)
    })
  })

  describe('нормализация результата db.execute (форма {rows: [...]}, тот же приём, что AnalogCandidatesAdapter)', () => {
    it('распознаёт результат в форме {rows: [...]}, не только плоский массив', async () => {
      const db: DrizzleMock = { execute: vi.fn(() => Promise.resolve({ rows: [BASE_ROW] })) }
      const pins = await makeAdapter(db).findPinsInBbox(makeQuery())
      expect(pins).toHaveLength(1)
      expect(pins[0]?.pharmacyId).toBe('ph-1')
    })
  })

  // ─── Что НЕ покрыто в этом файле ─────────────────────────────────────
  //
  // 1. Интеграционные сценарии тест-плана DTJ-195 (требуют testcontainers Postgres, EP-19):
  //    bbox включение/исключение по границе (TC эквивалент, GiST `&&`), suspended-сеть
  //    исключена (TC-CAT-019-эквивалент), нулевой остаток → offer=null на реальных данных,
  //    narcotic → offer=null на реальных данных, `EXPLAIN` подтверждает Index Scan по
  //    `ix_pharmacies_geo_point`.
  // 2. ДАЖЕ после раскатки EP-19 сценарии из п.1 не заработают, пока не появится миграция,
  //    добавляющая `pharmacies.geo_point`/расширение `postgis`/индекс `ix_pharmacies_geo_point`
  //    — см. JSDoc адаптера, блок «ВАЖНО», п.1. Никакой найденный тикет её не берёт на себя.
  //
  // Оба пункта зафиксированы как `blockers` в отчёте сдачи DTJ-195 (§9 хендбука запрещает
  // `it.skip`/`it.todo` вместо честного отчёта).
})
