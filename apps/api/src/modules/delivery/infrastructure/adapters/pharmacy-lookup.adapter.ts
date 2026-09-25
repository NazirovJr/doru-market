import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import {
  PHARMACY_LOOKUP_PORT,
  type PharmacyLocation,
  type PharmacyLookupPort,
} from '@/modules/delivery/application/ports/pharmacy-lookup.port.js'

@Injectable()
export class DrizzlePharmacyLookupAdapter implements PharmacyLookupPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findById(pharmacyId: string): Promise<PharmacyLocation | null> {
    const rows = await this.db
      .select({ id: pharmacies.id, name: pharmacies.name, addressText: pharmacies.addressText, latitude: pharmacies.latitude, longitude: pharmacies.longitude, chainId: pharmacies.chainId })
      .from(pharmacies)
      .where(eq(pharmacies.id, pharmacyId))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    const geoPoint = GeoPoint.create(Number(row.latitude), Number(row.longitude))
    if (!geoPoint.ok) {
      // Данные в БД уже прошли валидацию при создании аптеки — недостижимо в норме.
      throw new Error(`pharmacy ${pharmacyId}: invalid stored coordinates`)
    }
    return { id: row.id, name: row.name, addressText: row.addressText, geoPoint: geoPoint.value, chainId: row.chainId }
  }
}

export const PHARMACY_LOOKUP_PORT_PROVIDER = {
  provide: PHARMACY_LOOKUP_PORT,
  useClass: DrizzlePharmacyLookupAdapter,
} as const
