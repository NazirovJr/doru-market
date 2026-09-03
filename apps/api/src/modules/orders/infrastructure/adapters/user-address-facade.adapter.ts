/**
 * `UserAddressFacadeAdapter` (EP-09, DTJ-229) — реализация `UserAddressFacadePort` поверх
 * `user_addresses` (`db/schema/user-addresses.ts`, DTJ-014). Читает таблицу НАПРЯМУЮ (тот же
 * приём, что `CatalogFacadeAdapter` читает `pharmacy_inventory` напрямую параллельно вызову
 * фасада чужого модуля, `infrastructure/adapters/catalog-facade.adapter.ts` JSDoc) — `auth`/
 * `users` не экспортирует порт для этой таблицы (проверено перед заведением, JSDoc порта).
 *
 * `customerId` — ОБЯЗАТЕЛЬНЫЙ фильтр `WHERE user_id = :customerId` В ТОМ ЖЕ запросе (не
 * отдельная проверка владения после чтения) — чужой адрес по `id` не подтверждается как
 * существующий (D-EP09-11/SRS-API-046, тот же приём, что тенант-скоуп репозиториев).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { userAddresses } from '@/db/schema/user-addresses.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import {
  USER_ADDRESS_FACADE_PORT,
  type UserAddressFacadePort,
  type UserAddressSnapshot,
} from '@/modules/orders/application/ports/user-address-facade.port.js'

@Injectable()
export class UserAddressFacadeAdapter implements UserAddressFacadePort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async getById(addressId: string, customerId: string): Promise<UserAddressSnapshot | null> {
    const rows = await this.db
      .select()
      .from(userAddresses)
      .where(and(eq(userAddresses.id, addressId), eq(userAddresses.userId, customerId)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return {
      id: row.id,
      addressText: row.addressText,
      landmarkText: row.landmarkText,
      geoPoint: rowToGeoPointOrThrow(row.latitude, row.longitude, row.id),
    }
  }
}

/**
 * `null` координаты — легитимно (см. JSDoc `UserAddressSnapshot`). Присутствующие, но
 * вне диапазона — испорченная строка (VO уже валидировал бы на запись, DTJ-014) — падает
 * громко, тот же приём, что `rowToGeoPoint` в `order.repository.ts`.
 */
function rowToGeoPointOrThrow(latitude: string | null, longitude: string | null, addressId: string): GeoPoint | null {
  if (latitude === null || longitude === null) {
    return null
  }
  const result = GeoPoint.create(Number(latitude), Number(longitude))
  if (!result.ok) {
    throw new Error(`user_addresses row ${addressId} carries out-of-range coordinates — data integrity violation`)
  }
  return result.value
}

export const USER_ADDRESS_FACADE_PORT_PROVIDER = {
  provide: USER_ADDRESS_FACADE_PORT,
  useClass: UserAddressFacadeAdapter,
} as const
