// В R1 рецептурные позиции исключаются на checkout (DTJ-230), у заказа нет рецепта — null верен до модуля prescriptions (R2).
import { Injectable } from '@nestjs/common'
import type { PrescriptionMetaView, PrescriptionsFacadePort } from '@/modules/admin/application/ports/prescriptions-facade.port.js'

@Injectable()
export class NullPrescriptionsFacadeAdapter implements PrescriptionsFacadePort {
  getPrescriptionMetaByOrder(_orderId: string): Promise<PrescriptionMetaView | null> {
    return Promise.resolve(null)
  }
}
