/**
 * `DrizzlePharmacyChainLookupAdapter` (DTJ-252) — реализация `PharmacyChainLookupPort` поверх
 * `pharmacies` (`db/schema/pharmacies.ts`). Чтение ЧУЖОЙ Drizzle-схемы (`onboarding` владеет
 * `pharmacies`) из своего `infrastructure` — НЕ межмодульный deep-import (`02-CLEAN-ARCHITECTURE-
 * AND-CODE.md` §1.1 запрещает импорт `domain`/`application` чужого модуля, не таблицы), тот же
 * прецедент, что `DrizzlePayoutScheduleRepository` читает `orders` (DTJ-245).
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import { PHARMACY_CHAIN_LOOKUP, type PharmacyChainLookupPort } from '@/modules/payments/application/ports/pharmacy-chain-lookup.port.js'

@Injectable()
export class DrizzlePharmacyChainLookupAdapter implements PharmacyChainLookupPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findChainId(pharmacyId: string): Promise<string | null> {
    const rows = await this.db.select({ chainId: pharmacies.chainId }).from(pharmacies).where(eq(pharmacies.id, pharmacyId)).limit(1)
    const row = rows[0]
    return row?.chainId ?? null
  }
}

export const PHARMACY_CHAIN_LOOKUP_PROVIDER = {
  provide: PHARMACY_CHAIN_LOOKUP,
  useClass: DrizzlePharmacyChainLookupAdapter,
} as const
