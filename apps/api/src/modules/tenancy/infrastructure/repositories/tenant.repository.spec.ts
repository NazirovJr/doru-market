/**
 * Unit-тест `DrizzleTenantRepository` (DTJ-052 follow-up, задача I).
 *
 * ДО этого файла у репозитория не было ни одного собственного теста — из-за этого
 * прошёл незамеченным баг: `findBySlug`/`findByCustomDomain`/`findByChainId` звали
 * `this.findById(row.id as unknown as TenantId)`. `row.id` — сырая `string` (колонка
 * `tenants.id` без `.$type<TenantId>()`), приведение типа НЕ создавало настоящий
 * `TenantId` — оно врало компилятору. Внутри `findById` это било в
 * `eq(tenants.id, id.value)`: у строки нет `.value` → `undefined` → `WHERE id = NULL`
 * никогда не матчит строку. `TenantResolutionMiddleware` вызывает эти три метода на
 * КАЖДОМ HTTP-запросе — ни один тенант не резолвился на живом Postgres.
 *
 * Мок `DrizzleDb` — in-memory, без реальной БД (testcontainers Postgres ещё не
 * раскатаны, см. `postgres-pharmacy-map.adapter.spec.ts`). Воспроизводит цепочку
 * `.select().from(table).where(eq(col, val)).limit(n)`, распознавая реальный
 * SQL-объект `eq()` (не эмулирует WHERE верхнеуровнево) — так тест ловит именно
 * форму бага: если в `WHERE` уходит `undefined` вместо настоящего uuid, фильтр
 * ничего не найдёт и метод вернёт `null` вместо тенанта.
 */
import { describe, expect, it } from 'vitest'
import { DrizzleTenantRepository } from './tenant.repository.js'
import { tenants, tenantSettings } from '@/db/schema/tenants.js'
import { TenantId } from '@/modules/tenancy/domain/value-objects/tenant-id.vo.js'
import type { DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'

type TenantRow = typeof tenants.$inferSelect
type TenantSettingsRow = typeof tenantSettings.$inferSelect
type TableName = 'tenants' | 'tenant_settings'

const TENANT_UUID = '550e8400-e29b-41d4-a716-446655440000'
const CHAIN_UUID = '650e8400-e29b-41d4-a716-446655440111'

function makeTenantRow(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: TENANT_UUID,
    slug: 'apteka-vasco',
    chainId: null,
    customDomain: null,
    isNeutral: false,
    courierSourcingMode: 'platform_pool',
    customDomainStatus: 'none',
    domainVerificationToken: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeSettingsRow(overrides: Partial<TenantSettingsRow> = {}): TenantSettingsRow {
  return {
    tenantId: TENANT_UUID,
    brandName: 'Apteka Vasco',
    brandLogoUrl: null,
    brandLogoSquareUrl: null,
    brandFaviconUrl: null,
    brandPalette: {},
    telegramBotUsername: null,
    telegramBotTokenRef: null,
    merchantCredentialsRef: null,
    merchantCredentialsStatus: 'not_configured',
    supportPhone: null,
    supportEmail: null,
    codLimitDiram: 50000n,
    holdPeriodDays: 1,
    pickupSlaMinutes: 7,
    pickupSlaBufferMinutes: 5,
    deliverySlaCityMinutes: 240,
    deliverySlaRemoteMinutes: 1440,
    disputeWindowHours: 24,
    inventoryDeltaSlaMinutes: 5,
    returnRestockMinRemainingDays: 30,
    // DTJ-278 (EP-14, migration 0038_support_ticket_sla_fields.sql) добавил NOT NULL-колонку
    // в tenant_settings — фикстура этого файла (чужой files_owned, EP-02) обновлена ОДНОЙ
    // строкой, иначе typecheck красный для всего репозитория (см. отчёт DTJ-278, foundIssues).
    supportFirstResponseSlaMinutes: 60,
    defaultLocale: 'tj',
    // DTJ-300 (EP-12, модуль 24) — дефолты из tenant_settings (10/20/60).
    partialFulfillmentConfirmationTimeoutMinutes: 10,
    handoverOtpMaxRegenerationsPerOrder: 20,
    handoverOtpRegenerateMinIntervalSeconds: 60,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

/** DB-колонка (snake_case) → JS-ключ строки (camelCase) — только колонки, реально
 *  участвующие в `WHERE` этого репозитория. */
const COLUMN_TO_ROW_KEY: Record<string, string> = {
  id: 'id',
  slug: 'slug',
  custom_domain: 'customDomain',
  chain_id: 'chainId',
  tenant_id: 'tenantId',
}

type SqlChunk = Record<string, unknown>

function isObjectChunk(chunk: unknown): chunk is SqlChunk {
  return chunk !== null && typeof chunk === 'object'
}

/** Column-чанк — `PgColumn` (`.columnType`/`.name`), не `StringChunk`/`Param`. */
function isColumnChunk(chunk: unknown): chunk is SqlChunk & { name: string } {
  return isObjectChunk(chunk) && 'columnType' in chunk && typeof chunk.name === 'string'
}

/** Param-чанк — связанное значение `eq()` (`.brand === 'Param'`, несёт `.value`). */
function isParamChunk(chunk: unknown): chunk is SqlChunk & { value: unknown } {
  return isObjectChunk(chunk) && 'brand' in chunk && 'value' in chunk
}

/**
 * Извлекает `{columnName, value}` из настоящего SQL-объекта, который производит
 * `eq(column, value)` (drizzle-orm). Форма подтверждена инспекцией рантайма:
 * `queryChunks = [StringChunk, <column>, StringChunk(' = '), Param{value}, StringChunk]`.
 * НЕ эмулирует WHERE — читает то, что реально передал репозиторий, поэтому баг
 * «в WHERE ушёл undefined вместо uuid» ловится напрямую, а не по побочному эффекту.
 */
function parseEqCondition(cond: unknown): { columnName: string; value: unknown } {
  if (!isObjectChunk(cond) || !('queryChunks' in cond)) {
    throw new Error('Мок .where() ожидает SQL-объект eq(), см. JSDoc parseEqCondition')
  }
  const chunks = (cond as { queryChunks: readonly unknown[] }).queryChunks
  const columnChunk = chunks.find(isColumnChunk)
  if (columnChunk === undefined) {
    throw new Error('Не удалось извлечь имя колонки из eq() — форма SQL изменилась')
  }
  const paramChunk = chunks.find(isParamChunk)
  return { columnName: columnChunk.name, value: paramChunk?.value }
}

function tableNameOf(table: unknown): TableName {
  if (table === tenants) return 'tenants'
  if (table === tenantSettings) return 'tenant_settings'
  throw new Error('Мок .from() получил неизвестную Drizzle-таблицу')
}

interface WhereCall {
  readonly table: TableName
  readonly columnName: string
  readonly value: unknown
}

interface FakeDb {
  readonly db: DrizzleDb
  readonly whereCalls: WhereCall[]
  selectCallCount: number
}

/** In-memory мок `DrizzleDb`, покрывающий ровно цепочку, которую использует репозиторий. */
function makeFakeDb(tenantRows: readonly TenantRow[], settingsRows: readonly TenantSettingsRow[]): FakeDb {
  const whereCalls: WhereCall[] = []
  let selectCallCount = 0
  const select = (): unknown => {
    selectCallCount += 1
    return {
      from(table: unknown) {
        const name = tableNameOf(table)
        return {
          where(cond: unknown) {
            const { columnName, value } = parseEqCondition(cond)
            whereCalls.push({ table: name, columnName, value })
            const rowKey = COLUMN_TO_ROW_KEY[columnName]
            if (rowKey === undefined) {
              throw new Error(`Мок не знает колонку "${columnName}" — дополни COLUMN_TO_ROW_KEY`)
            }
            const source: readonly Record<string, unknown>[] = name === 'tenants' ? tenantRows : settingsRows
            const filtered = source.filter((row) => row[rowKey] === value)
            return {
              limit(_n: number) {
                return Promise.resolve(filtered)
              },
            }
          },
        }
      },
    }
  }
  const db = { select } as unknown as DrizzleDb
  return {
    db,
    whereCalls,
    get selectCallCount() {
      return selectCallCount
    },
  }
}

describe('DrizzleTenantRepository (DTJ-052, задача I)', () => {
  describe('findBySlug — регресс: WHERE для tenant_settings обязан получить реальный uuid', () => {
    it('находит тенанта по slug, а не null (баг: второй запрос уходил с undefined)', async () => {
      const fake = makeFakeDb([makeTenantRow()], [makeSettingsRow()])
      const repo = new DrizzleTenantRepository(fake.db)

      const tenant = await repo.findBySlug('apteka-vasco')

      expect(tenant).not.toBeNull()
      expect(tenant?.id.value).toBe(TENANT_UUID)
      expect(tenant?.slug.value).toBe('apteka-vasco')
    })

    it('WHERE tenant_settings.tenant_id получает настоящий uuid строки tenants, не undefined', async () => {
      const fake = makeFakeDb([makeTenantRow()], [makeSettingsRow()])
      const repo = new DrizzleTenantRepository(fake.db)

      await repo.findBySlug('apteka-vasco')

      const settingsWhere = fake.whereCalls.find((c) => c.table === 'tenant_settings')
      expect(settingsWhere).toBeDefined()
      expect(settingsWhere?.value).toBe(TENANT_UUID)
      expect(settingsWhere?.value).not.toBeUndefined()
    })

    it('делает ровно 2 запроса (tenants + tenant_settings), без лишнего повторного похода в tenants', async () => {
      const fake = makeFakeDb([makeTenantRow()], [makeSettingsRow()])
      const repo = new DrizzleTenantRepository(fake.db)

      await repo.findBySlug('apteka-vasco')

      expect(fake.selectCallCount).toBe(2)
    })

    it('slug не найден в tenants → null, tenant_settings не запрашивается', async () => {
      const fake = makeFakeDb([makeTenantRow()], [makeSettingsRow()])
      const repo = new DrizzleTenantRepository(fake.db)

      const tenant = await repo.findBySlug('does-not-exist')

      expect(tenant).toBeNull()
      expect(fake.whereCalls.some((c) => c.table === 'tenant_settings')).toBe(false)
    })
  })

  describe('findByCustomDomain — тот же паттерн бага', () => {
    it('находит тенанта по custom domain, а не null', async () => {
      const row = makeTenantRow({ customDomain: 'apteka.tj', customDomainStatus: 'verified' })
      const fake = makeFakeDb([row], [makeSettingsRow()])
      const repo = new DrizzleTenantRepository(fake.db)

      const tenant = await repo.findByCustomDomain('apteka.tj')

      expect(tenant).not.toBeNull()
      expect(tenant?.id.value).toBe(TENANT_UUID)
      expect(tenant?.customDomain).toBe('apteka.tj')
    })

    it('домен не найден → null', async () => {
      const fake = makeFakeDb([makeTenantRow({ customDomain: 'apteka.tj' })], [makeSettingsRow()])
      const repo = new DrizzleTenantRepository(fake.db)

      expect(await repo.findByCustomDomain('other.tj')).toBeNull()
    })
  })

  describe('findByChainId — тот же паттерн бага', () => {
    it('находит тенанта сети по chainId, а не null', async () => {
      const row = makeTenantRow({ chainId: CHAIN_UUID })
      const fake = makeFakeDb([row], [makeSettingsRow()])
      const repo = new DrizzleTenantRepository(fake.db)

      const tenant = await repo.findByChainId(TenantId.from(CHAIN_UUID))

      expect(tenant).not.toBeNull()
      expect(tenant?.id.value).toBe(TENANT_UUID)
      expect(tenant?.chainId?.value).toBe(CHAIN_UUID)
    })

    it('WHERE tenant_settings.tenant_id получает id найденного тенанта, не chainId', async () => {
      const row = makeTenantRow({ chainId: CHAIN_UUID })
      const fake = makeFakeDb([row], [makeSettingsRow()])
      const repo = new DrizzleTenantRepository(fake.db)

      await repo.findByChainId(TenantId.from(CHAIN_UUID))

      const settingsWhere = fake.whereCalls.find((c) => c.table === 'tenant_settings')
      expect(settingsWhere?.value).toBe(TENANT_UUID)
    })

    it('chainId не найден → null', async () => {
      const fake = makeFakeDb([makeTenantRow({ chainId: CHAIN_UUID })], [makeSettingsRow()])
      const repo = new DrizzleTenantRepository(fake.db)

      expect(await repo.findByChainId(TenantId.from('750e8400-e29b-41d4-a716-446655440222'))).toBeNull()
    })
  })

  describe('findById — прямой путь (не через баг, но репозиторий был без покрытия совсем)', () => {
    it('находит тенанта по id', async () => {
      const fake = makeFakeDb([makeTenantRow()], [makeSettingsRow()])
      const repo = new DrizzleTenantRepository(fake.db)

      const tenant = await repo.findById(TenantId.from(TENANT_UUID))

      expect(tenant).not.toBeNull()
      expect(tenant?.id.value).toBe(TENANT_UUID)
    })

    it('id не найден → null', async () => {
      const fake = makeFakeDb([], [])
      const repo = new DrizzleTenantRepository(fake.db)

      expect(await repo.findById(TenantId.from(TENANT_UUID))).toBeNull()
    })
  })
})
