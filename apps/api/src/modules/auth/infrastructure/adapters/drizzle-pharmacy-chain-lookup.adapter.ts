import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import type { PharmacyChainLookupPort } from '@/modules/auth/application/ports/pharmacy-chain-lookup.port.js'

@Injectable()
export class DrizzlePharmacyChainLookupAdapter implements PharmacyChainLookupPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findChainIdByPharmacyId(pharmacyId: string): Promise<string | null> {
    const rows = await this.db
      .select({ chainId: pharmacies.chainId })
      .from(pharmacies)
      .where(eq(pharmacies.id, pharmacyId))
      .limit(1)
    return rows[0]?.chainId ?? null
  }
}
