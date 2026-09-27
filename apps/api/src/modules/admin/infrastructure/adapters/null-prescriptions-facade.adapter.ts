// TODO(DTJ-374): заменить реальным адаптером, когда появится модуль prescriptions.
import { Injectable } from '@nestjs/common'
import type { PrescriptionMetaView, PrescriptionsFacadePort } from '@/modules/admin/application/ports/prescriptions-facade.port.js'

@Injectable()
export class NullPrescriptionsFacadeAdapter implements PrescriptionsFacadePort {
  getPrescriptionMetaByOrder(_orderId: string): Promise<PrescriptionMetaView | null> {
    return Promise.resolve(null)
  }
}
