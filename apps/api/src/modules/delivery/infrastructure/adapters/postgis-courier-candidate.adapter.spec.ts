import { describe, expect, it, vi } from 'vitest'
import { getTableName, is, Table, type SQL } from 'drizzle-orm'
import { GeoPoint } from '@/shared-kernel/index.js'
import { PostgisCourierCandidateAdapter } from './postgis-courier-candidate.adapter.js'
import type { CourierCandidateQuery } from '@/modules/delivery/application/ports/courier-candidate.port.js'

function requireGeoPoint(lat: number, lon: number): GeoPoint {
  const result = GeoPoint.create(lat, lon)
  if (!result.ok) throw result.error
  return result.value
}

const PHARMACY_GEO_POINT = requireGeoPoint(38.5598, 68.787)

function makeQuery(overrides: Partial<CourierCandidateQuery> = {}): CourierCandidateQuery {
  return {
    pharmacyGeoPoint: PHARMACY_GEO_POINT,
    pharmacyChainId: 'chain-1',
    requiresColdChain: false,
    courierSourcingMode: 'hybrid',
    radiusKm: 5,
    maxConcurrentAssignments: 3,
    locationStaleMinutes: 15,
    ...overrides,
  }
}

interface DrizzleMock {
  readonly execute: ReturnType<typeof vi.fn>
}

function makeDrizzleMock(rows: readonly Record<string, unknown>[]): DrizzleMock {
  return { execute: vi.fn(() => Promise.resolve(rows)) }
}

function makeAdapter(db: DrizzleMock): PostgisCourierCandidateAdapter {
  return new PostgisCourierCandidateAdapter(db as unknown as ConstructorParameters<typeof PostgisCourierCandidateAdapter>[0])
}

/** 1:1 `postgres-pharmacy-map.adapter.spec.ts` (DTJ-195) — рендер `SQL` включая вложенные фрагменты. */
function renderSql(query: SQL): string {
  return query.queryChunks.map(renderChunk).join(' ')
}

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
  if (is(chunk, Table)) {
    return getTableName(chunk)
  }
  if (hasOwnKey(chunk, 'name')) {
    return String(chunk.name)
  }
  return String(chunk)
}

function capturedSql(db: DrizzleMock): string {
  const [query] = db.execute.mock.calls[0] as [SQL]
  return renderSql(query)
}

describe('PostgisCourierCandidateAdapter', () => {
  it('SQL: фильтрует по status=active, shift_status=on_shift, исключает терминальные назначения из счётчика', async () => {
    const db = makeDrizzleMock([])
    await makeAdapter(db).findEligibleCandidates(makeQuery())
    const text = capturedSql(db)
    expect(text).toContain("'active'")
    expect(text).toContain("'on_shift'")
    expect(text).toContain("'delivered'")
    expect(text).toContain("'delivery_failed'")
    expect(text).toContain('couriers')
  })

  it('SQL: не содержит ST_DWithin/PostGIS (гаверсинус вместо него, см. JSDoc адаптера)', async () => {
    const db = makeDrizzleMock([])
    await makeAdapter(db).findEligibleCandidates(makeQuery())
    const text = capturedSql(db)
    expect(text).not.toContain('ST_DWithin')
    expect(text).toContain('asin')
    expect(text).toContain('radians')
  })

  it('маппинг: строка результата -> CourierCandidate (ratingAvg/activeAssignmentsCount/distanceMeters уже number — SQL кастует ::double precision/::int, 1:1 PinRow в postgres-pharmacy-map.adapter.ts, без Number())', async () => {
    const db = makeDrizzleMock([
      {
        courierId: 'courier-1',
        courierChainId: null,
        coldChainCertified: false,
        ratingAvg: 4.5,
        activeAssignmentsCount: 2,
        distanceMeters: 1234.5,
      },
    ])
    const [candidate] = await makeAdapter(db).findEligibleCandidates(makeQuery())
    expect(candidate).toEqual({
      courierId: 'courier-1',
      courierChainId: null,
      coldChainCertified: false,
      ratingAvg: 4.5,
      activeAssignmentsCount: 2,
      distanceMeters: 1234.5,
    })
  })

  it('маппинг: пустой результат -> пустой массив (extractRows устойчив к разным формам db.execute)', async () => {
    const db: DrizzleMock = { execute: vi.fn(() => Promise.resolve({ rows: [] })) }
    const result = await makeAdapter(db).findEligibleCandidates(makeQuery())
    expect(result).toEqual([])
  })
})
